/**
 * Rotas de DEMO local — PNCP + chat Gemini (lista / detalhe / ask).
 *
 * SOMENTE em NODE_ENV !== production. Em produção o router nem é montado.
 * Auth JWT (AUTH_MODE=dev) igual às demais rotas /api/*.
 *
 * GET  /api/demo/editais?q=&max=&janelaDias=
 * GET  /api/demo/editais/:numeroControlePncp
 * POST /api/demo/chat  { mensagem, numeroControlePncp? }
 */

import { Hono } from 'hono';
import type { ContratacaoData } from '@radar/ingestao';
import { PncpHttpGateway } from '@radar/ingestao/infra';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { responderErro } from '../errors.js';
import {
  listarLoteDemo,
  obterDoLoteDemo,
  resumoLoteParaChat,
  salvarLoteDemo,
} from '../infra/demo-pncp-store.js';
import { perguntarComCursor } from '../infra/cursor-chat.js';

/** Concorrência (obras) antes de pregão — evita o lote virar 100% modalidade 6. */
const MODALIDADES = [4, 5, 6, 8, 9, 12, 7, 1, 3, 10, 11, 13, 2] as const;
/** Teto por modalidade no ciclo demo — garante variedade (obras, dispensa, etc.). */
const POR_MODALIDADE = 5;

const INSTRUCAO_CHAT = [
  'Você é o assistente do Radar de Licitações (contratações públicas do PNCP).',
  'Responda APENAS com base no CONTEXTO fornecido (editais já coletados).',
  'Cite sempre o numeroControlePNCP quando mencionar uma oportunidade.',
  'Se a informação não estiver no contexto, diga explicitamente que não sabe.',
  'Não invente valores, prazos ou recomendações go/no-go fora do que o contexto traz.',
  'Não peça nem use dados de estratégia comercial do cliente.',
].join(' ');

export function criarDemoRouter(): Hono {
  const router = new Hono();
  router.use('/*', autenticarMiddleware);

  router.get('/editais', async (c) => {
    try {
      const q = (c.req.query('q') ?? '').trim().toLowerCase();
      const max = clampInt(c.req.query('max'), 30, 1, 50);
      const janelaDias = clampInt(c.req.query('janelaDias'), 7, 1, 30);
      const force = c.req.query('refresh') === '1';

      let { itens, coletadoEm } = listarLoteDemo();
      if (force || itens.length === 0) {
        itens = await coletarPncp(max, janelaDias, c.req.raw.signal);
        salvarLoteDemo(itens);
        coletadoEm = new Date().toISOString();
      }

      const filtrados = q
        ? itens.filter((ed) => {
            const hay = `${ed.objeto} ${ed.orgao.nome} ${ed.orgao.uf} ${ed.modalidadeNome}`.toLowerCase();
            const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
            if (tokens.length === 0) return hay.includes(q);
            return tokens.some((t) => hay.includes(t));
          })
        : itens;

      return c.json({
        coletadoEm,
        total: filtrados.length,
        editais: filtrados.map(paraCardDto),
      });
    } catch (err) {
      return responderErro(c, err);
    }
  });

  router.get('/editais/:numero', async (c) => {
    try {
      const numero = decodeURIComponent(c.req.param('numero'));
      let item = obterDoLoteDemo(numero);
      if (!item) {
        // tenta hidratar lote se vazio
        const { itens } = listarLoteDemo();
        if (itens.length === 0) {
          const coletados = await coletarPncp(30, 7, c.req.raw.signal);
          salvarLoteDemo(coletados);
          item = obterDoLoteDemo(numero);
        }
      }
      if (!item) {
        return c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Edital não está no lote local.' }, 404);
      }
      return c.json(paraDetalheDto(item));
    } catch (err) {
      return responderErro(c, err);
    }
  });

  router.post('/chat', async (c) => {
    try {
      if (process.env['NODE_ENV'] === 'production') {
        return c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Demo indisponível.' }, 404);
      }

      const body = (await c.req.json()) as { mensagem?: unknown; numeroControlePncp?: unknown };
      const mensagem = typeof body.mensagem === 'string' ? body.mensagem.trim() : '';
      if (!mensagem) {
        return c.json({ code: 'VALIDACAO', mensagem: 'mensagem é obrigatória.' }, 400);
      }
      const destaque =
        typeof body.numeroControlePncp === 'string' ? body.numeroControlePncp.trim() : undefined;

      let { itens } = listarLoteDemo();
      if (itens.length === 0) {
        itens = await coletarPncp(20, 7, c.req.raw.signal);
        salvarLoteDemo(itens);
      }

      const contexto = resumoLoteParaChat(itens, destaque);
      const cursorKey = process.env['CURSOR_API_KEY']?.trim();
      const geminiKey = process.env['GEMINI_API_KEY']?.trim();

      if (cursorKey) {
        const modelo = process.env['CURSOR_MODEL']?.trim() || 'composer-2.5';
        const texto = await perguntarComCursor({
          apiKey: cursorKey,
          modelo,
          mensagem,
          contexto,
          nodeEnv: process.env['NODE_ENV'],
        });
        return c.json({ resposta: texto, provider: 'cursor' });
      }

      if (geminiKey) {
        const modelo = process.env['GEMINI_MODEL']?.trim() || 'gemini-2.0-flash';
        const texto = await chamarGeminiChat({
          apiKey: geminiKey,
          modelo,
          mensagem,
          contexto,
          signal: c.req.raw.signal,
        });
        return c.json({ resposta: texto, provider: 'gemini' });
      }

      return c.json(
        {
          code: 'CONFIG',
          mensagem:
            'Nenhuma chave de LLM: defina CURSOR_API_KEY (preferido) ou GEMINI_API_KEY em apps/api/.env',
        },
        503,
      );
    } catch (err) {
      // Demo: devolve mensagem real em development (ajuda a depurar Cursor/Gemini)
      if (process.env['NODE_ENV'] !== 'production' && err instanceof Error) {
        console.error('[demo/chat]', err.message);
        return c.json({ code: 'DEMO_CHAT', mensagem: err.message }, 502);
      }
      return responderErro(c, err);
    }
  });

  return router;
}

async function coletarPncp(
  max: number,
  janelaDias: number,
  signal: AbortSignal,
): Promise<ContratacaoData[]> {
  const gateway = new PncpHttpGateway();
  const fim = new Date();
  const inicio = new Date(fim.getTime() - janelaDias * 24 * 60 * 60 * 1000);
  const coletados: ContratacaoData[] = [];
  const vistos = new Set<string>();

  for (const modalidade of MODALIDADES) {
    if (coletados.length >= max) break;
    let nestaModalidade = 0;
    try {
      for await (const pagina of gateway.buscarContratacoesPorPublicacao(
        modalidade,
        { inicio, fim },
        signal,
      )) {
        for (const item of pagina) {
          if (vistos.has(item.numeroControlePncp)) continue;
          vistos.add(item.numeroControlePncp);
          coletados.push(item);
          nestaModalidade++;
          if (coletados.length >= max || nestaModalidade >= POR_MODALIDADE) break;
        }
        // 1 página por modalidade basta; o teto POR_MODALIDADE limita o restante
        break;
      }
    } catch {
      // degradação: pula modalidade
    }
  }
  return coletados;
}

function paraCardDto(c: ContratacaoData) {
  return {
    numeroControlePncp: c.numeroControlePncp,
    modalidadeCodigo: c.modalidadeCodigo,
    modalidadeNome: c.modalidadeNome,
    objeto: c.objeto,
    orgao: c.orgao.nome,
    municipio: c.orgao.municipio,
    uf: c.orgao.uf,
    valorEstimado: c.valorEstimado,
    prazoProposta: c.prazoProposta?.toISOString() ?? null,
    dataPublicacao: c.dataPublicacao.toISOString(),
    faseAtual: c.faseAtual,
  };
}

function paraDetalheDto(c: ContratacaoData) {
  return {
    ...paraCardDto(c),
    orgaoCnpj: c.orgao.cnpj,
    itens: c.itens.map((i) => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado,
    })),
  };
}

async function chamarGeminiChat(opts: {
  apiKey: string;
  modelo: string;
  mensagem: string;
  contexto: string;
  signal: AbortSignal;
}): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(opts.modelo)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const body = {
    system_instruction: { parts: [{ text: INSTRUCAO_CHAT }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `<contexto_editais_nao_confiavel>\n${opts.contexto}\n</contexto_editais_nao_confiavel>\n\n` +
              `Pergunta do usuário: ${opts.mensagem}`,
          },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    throw new Error(`Gemini HTTP ${resp.status}: ${detalhe.slice(0, 240)}`);
  }

  const json = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini bloqueou (${json.promptFeedback.blockReason})`);
  }
  const texto = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!texto.trim()) throw new Error('Gemini não devolveu texto.');
  return texto.trim();
}

function clampInt(raw: string | undefined, padrao: number, min: number, max: number): number {
  const n = raw ? Number(raw) : padrao;
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
