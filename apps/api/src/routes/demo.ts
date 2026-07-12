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
import type { ConsultarPerfilHabilitacaoUseCase } from '@radar/identidade';
import type { TenantId } from '@radar/kernel';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { responderErro } from '../errors.js';
import {
  listarLoteDemo,
  obterDoLoteDemo,
  resumoLoteParaChat,
  salvarLoteDemo,
} from '../infra/demo-pncp-store.js';
import { perguntarComCursor } from '../infra/cursor-chat.js';
import { INSTRUCAO_ESPECIALISTA_CONTRATOS } from '../infra/demo-chat-instrucao.js';
import { paraTextoPlano } from '../infra/texto-plano.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';

/** Concorrência (obras) antes de pregão — evita o lote virar 100% modalidade 6. */
const MODALIDADES = [4, 5, 6, 8, 9, 12, 7, 1, 3, 10, 11, 13, 2] as const;
/** Teto por modalidade no ciclo demo — garante variedade (obras, dispensa, etc.). */
const POR_MODALIDADE = 5;

export interface DemoRouterDeps {
  consultarPerfil?: ConsultarPerfilHabilitacaoUseCase;
  perfilAtivo?: PerfilAtivoGateway;
  rematch?: (tenantId: TenantId, signal: AbortSignal) => Promise<number>;
  tamanhoCatalogo?: () => number;
}

export function criarDemoRouter(deps: DemoRouterDeps = {}): Hono {
  const router = new Hono();
  router.use('/*', autenticarMiddleware);

  router.get('/stats', async (c) => {
    const { itens, coletadoEm } = listarLoteDemo();
    return c.json({
      loteSize: itens.length,
      catalogoSize: deps.tamanhoCatalogo?.() ?? itens.length,
      coletadoEm,
    });
  });

  router.post('/rematch', async (c) => {
    try {
      const tenantId = c.get('tenantId');
      if (!deps.rematch) {
        return c.json({ code: 'CONFIG', mensagem: 'Rematch indisponível.' }, 503);
      }
      const gerados = await deps.rematch(tenantId, c.req.raw.signal);
      return c.json({ alertasGerados: gerados });
    } catch (err) {
      return responderErro(c, err);
    }
  });

  router.get('/editais', async (c) => {
    try {
      const q = (c.req.query('q') ?? '').trim().toLowerCase();
      const uf = (c.req.query('uf') ?? '').trim().toUpperCase();
      const max = clampInt(c.req.query('max'), 50, 1, 80);
      const janelaDias = clampInt(c.req.query('janelaDias'), 7, 1, 30);
      const force = c.req.query('refresh') === '1';

      let { itens, coletadoEm } = listarLoteDemo();
      if (force || itens.length === 0) {
        itens = await coletarPncp(max, janelaDias, c.req.raw.signal);
        salvarLoteDemo(itens);
        coletadoEm = new Date().toISOString();
        if (deps.rematch) {
          try {
            await deps.rematch(c.get('tenantId'), c.req.raw.signal);
          } catch (err) {
            console.warn('[demo/editais] rematch:', err instanceof Error ? err.message : err);
          }
        }
      }

      const filtrados = itens.filter((ed) => {
        if (uf && ed.orgao.uf.toUpperCase() !== uf) return false;
        if (!q) return true;
        const hay =
          `${ed.objeto} ${ed.orgao.nome} ${ed.orgao.uf} ${ed.orgao.municipio} ` +
          `${ed.modalidadeNome} ${ed.processo ?? ''} ${ed.numeroCompra ?? ''}`.toLowerCase();
        // Tokens curtos (≥2) para UF/siglas; OR amplo entre palavras do atalho de setor.
        const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
        if (tokens.length === 0) return hay.includes(q);
        return tokens.some((t) => hay.includes(t));
      });

      return c.json({
        coletadoEm,
        total: filtrados.length,
        editais: filtrados.map(paraCardDto),
      });    } catch (err) {
      return responderErro(c, err);
    }
  });

  router.get('/editais/:numero', async (c) => {
    try {
      const numero = decodeURIComponent(c.req.param('numero'));
      let item = obterDoLoteDemo(numero);
      if (!item) {
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

      const gateway = new PncpHttpGateway();
      const signal = c.req.raw.signal;

      // Clique no card → hidrata detalhe + itens + anexos no PNCP (lista só traz metadados).
      const [detalhePncp, arquivosRaw] = await Promise.all([
        gateway.buscarContratacaoPorNumero(item.numeroControlePncp, signal).catch((err) => {
          console.warn(
            '[demo/editais] detalhe indisponível:',
            err instanceof Error ? err.message : err,
          );
          return null;
        }),
        gateway.buscarArquivos(item.numeroControlePncp, signal).catch((err) => {
          console.warn(
            '[demo/editais] anexos indisponíveis:',
            err instanceof Error ? err.message : err,
          );
          return [] as Awaited<ReturnType<PncpHttpGateway['buscarArquivos']>>;
        }),
      ]);

      const completo = detalhePncp ? fundirDetalhe(item, detalhePncp) : item;
      const arquivos = arquivosRaw.map((a) => ({
        nome: a.nome,
        url: a.urlOrigem,
        tipoMime: a.tipoMime,
      }));

      return c.json({
        ...paraDetalheDto(completo),
        urlPortalPncp: urlPortalPncp(completo.numeroControlePncp),
        arquivos,
      });
    } catch (err) {
      return responderErro(c, err);
    }
  });

  router.post('/chat', async (c) => {
    try {
      if (process.env['NODE_ENV'] === 'production') {
        return c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Demo indisponível.' }, 404);
      }

      const body = (await c.req.json()) as {
        mensagem?: unknown;
        numeroControlePncp?: unknown;
        perfilEmpresa?: unknown;
      };
      const mensagem = typeof body.mensagem === 'string' ? body.mensagem.trim() : '';
      if (!mensagem) {
        return c.json({ code: 'VALIDACAO', mensagem: 'mensagem é obrigatória.' }, 400);
      }
      const destaque =
        typeof body.numeroControlePncp === 'string' ? body.numeroControlePncp.trim() : undefined;
      let perfilEmpresa =
        typeof body.perfilEmpresa === 'string' ? body.perfilEmpresa.trim() : '';

      // Sem perfil digitado no chat: usa Perfil de Habilitação salvo do tenant.
      if (!perfilEmpresa && deps.consultarPerfil && deps.perfilAtivo) {
        try {
          const tenantId = c.get('tenantId');
          const ativo = await deps.perfilAtivo.resolverParaTenant(tenantId, c.req.raw.signal);
          if (ativo) {
            const dto = await deps.consultarPerfil.executar(
              { tenantId, clienteFinalId: ativo.clienteFinalId },
              c.req.raw.signal,
            );
            if (dto) {
              perfilEmpresa = [
                'Habilitação jurídica:',
                ...dto.habJuridica.map((i) => `- ${i}`),
                '',
                'Habilitação fiscal/trabalhista:',
                ...dto.habFiscal.map((i) => `- ${i}`),
                '',
                'Qualificação técnica:',
                ...dto.habTecnica.map((i) => `- ${i}`),
                '',
                'Qualificação econômico-financeira:',
                ...dto.habEconomica.map((i) => `- ${i}`),
              ].join('\n');
            }
          }
        } catch (err) {
          console.warn('[demo/chat] perfil API:', err instanceof Error ? err.message : err);
        }
      }

      let { itens } = listarLoteDemo();
      if (itens.length === 0) {
        itens = await coletarPncp(20, 7, c.req.raw.signal);
        salvarLoteDemo(itens);
      }

      // Se há edital selecionado, hidrata detalhe+itens no contexto do especialista.
      let destaqueRico: ContratacaoData | null = destaque
        ? (obterDoLoteDemo(destaque) ?? null)
        : null;
      if (destaque) {
        try {
          const hidratado = await new PncpHttpGateway().buscarContratacaoPorNumero(
            destaque,
            c.req.raw.signal,
          );
          if (hidratado) {
            destaqueRico = destaqueRico ? fundirDetalhe(destaqueRico, hidratado) : hidratado;
          }
        } catch (err) {
          console.warn(
            '[demo/chat] detalhe do foco indisponível:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      const contexto = montarContextoChat(itens, destaque, destaqueRico, perfilEmpresa);
      const cursorKey = process.env['CURSOR_API_KEY']?.trim();
      const geminiKey = process.env['GEMINI_API_KEY']?.trim();

      if (cursorKey) {
        const modelo = process.env['CURSOR_MODEL']?.trim() || 'composer-2.5';
        const texto = await perguntarComCursor({
          apiKey: cursorKey,
          modelo,
          mensagem,
          contexto,
          instrucao: INSTRUCAO_ESPECIALISTA_CONTRATOS,
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
    srp: c.srp === true,
  };
}

function paraDetalheDto(c: ContratacaoData) {
  return {
    ...paraCardDto(c),
    orgaoCnpj: c.orgao.cnpj,
    numeroCompra: c.numeroCompra ?? null,
    processo: c.processo ?? null,
    modoDisputaNome: c.modoDisputaNome ?? null,
    amparoLegalNome: c.amparoLegalNome ?? null,
    dataAberturaProposta: c.dataAberturaProposta?.toISOString() ?? null,
    informacaoComplementar: c.informacaoComplementar ?? null,
    linkSistemaOrigem: c.linkSistemaOrigem ?? null,
    linkProcessoEletronico: c.linkProcessoEletronico ?? null,
    valorHomologado: c.valorHomologado ?? null,
    tipoInstrumentoNome: c.tipoInstrumentoNome ?? null,
    plataformaPublicacao: c.plataformaPublicacao ?? null,
    itens: c.itens.map((i) => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado,
      valorTotal: i.valorTotal ?? null,
      unidadeMedida: i.unidadeMedida ?? null,
      criterioJulgamentoNome: i.criterioJulgamentoNome ?? null,
      materialOuServicoNome: i.materialOuServicoNome ?? null,
    })),
  };
}

/** Preferência: detalhe PNCP sobrescreve lista; itens do detalhe ganham se vierem preenchidos. */
function fundirDetalhe(lista: ContratacaoData, detalhe: ContratacaoData): ContratacaoData {
  return {
    ...lista,
    ...detalhe,
    orgao: detalhe.orgao ?? lista.orgao,
    itens: detalhe.itens.length > 0 ? detalhe.itens : lista.itens,
  };
}

/** Página pública do edital no PNCP (mesma âncora do Banrisul no exemplo). */
function urlPortalPncp(numeroControlePncp: string): string | null {
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(numeroControlePncp.trim());
  if (!m) return null;
  const cnpj = m[1]!;
  const sequencial = String(Number(m[2]));
  const ano = m[3]!;
  return `https://pncp.gov.br/editais/${cnpj}/${ano}/${sequencial}`;
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
    system_instruction: { parts: [{ text: INSTRUCAO_ESPECIALISTA_CONTRATOS }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `<contexto_editais_nao_confiavel>\n${opts.contexto}\n</contexto_editais_nao_confiavel>\n\n` +
              `Pergunta / perfil do usuário: ${opts.mensagem}`,
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
  return paraTextoPlano(texto);
}

function clampInt(raw: string | undefined, padrao: number, min: number, max: number): number {
  const n = raw ? Number(raw) : padrao;
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function montarContextoChat(
  lote: readonly ContratacaoData[],
  destaque: string | undefined,
  destaqueRico: ContratacaoData | null,
  perfilEmpresa: string,
): string {
  const partes: string[] = [];
  if (perfilEmpresa) {
    partes.push('## Perfil da empresa (persistente — NÃO descartar ao trocar de edital)');
    partes.push('<perfil_empresa>');
    partes.push(perfilEmpresa);
    partes.push('</perfil_empresa>');
    partes.push('');
  }
  // Com card selecionado: contexto da oportunidade = só o painel de detalhe atual.
  if (destaque && destaqueRico) {
    partes.push('## Oportunidade em foco (painel de detalhe ATUAL — ignore editais anteriores)');
    partes.push(formatarEditalCompleto(destaqueRico));
    return partes.join('\n');
  }
  if (destaque) {
    const doLote = lote.find((c) => c.numeroControlePncp === destaque);
    partes.push(`## Oportunidade em foco: ${destaque} (detalhe completo indisponível)`);
    partes.push(doLote ? formatarEditalCompleto(doLote) : '(edital não encontrado no lote)');
    return partes.join('\n');
  }
  partes.push('## Lote atual (nenhum card selecionado)');
  partes.push(resumoLoteParaChat(lote));
  return partes.join('\n');
}

function formatarEditalCompleto(c: ContratacaoData): string {
  const linhas = [
    `numeroControlePNCP: ${c.numeroControlePncp}`,
    `modalidade: ${c.modalidadeCodigo} ${c.modalidadeNome}`,
    `fase: ${c.faseAtual}`,
    `objeto: ${c.objeto}`,
    `órgão: ${c.orgao.nome} (${c.orgao.municipio}/${c.orgao.uf}) CNPJ ${c.orgao.cnpj}`,
    `valorEstimado: ${c.valorEstimado ?? 'n/d'}`,
    `valorHomologado: ${c.valorHomologado ?? 'n/d'}`,
    `abertura: ${c.dataAberturaProposta?.toISOString() ?? 'n/d'}`,
    `encerramento: ${c.prazoProposta?.toISOString() ?? 'n/d'}`,
    `processo: ${c.processo ?? 'n/d'} | compra: ${c.numeroCompra ?? 'n/d'}`,
    `SRP: ${c.srp === true ? 'sim' : 'não'}`,
    `disputa: ${c.modoDisputaNome ?? 'n/d'}`,
    `amparo: ${c.amparoLegalNome ?? 'n/d'}`,
    `instrumento: ${c.tipoInstrumentoNome ?? 'n/d'}`,
    `portalOrigem: ${c.linkSistemaOrigem ?? 'n/d'}`,
    `plataforma: ${c.plataformaPublicacao ?? 'n/d'}`,
    `complementar: ${c.informacaoComplementar ?? 'n/d'}`,
  ];
  if (c.itens.length > 0) {
    linhas.push('itens:');
    for (const i of c.itens) {
      linhas.push(
        `  - #${i.numeroItem} ${i.descricao} | qtd=${i.quantidade}` +
          `${i.unidadeMedida ? ` ${i.unidadeMedida}` : ''}` +
          ` | unit=${i.valorUnitarioEstimado ?? 'n/d'}` +
          ` | total=${i.valorTotal ?? 'n/d'}` +
          `${i.criterioJulgamentoNome ? ` | ${i.criterioJulgamentoNome}` : ''}`,
      );
    }
  }
  return linhas.join('\n');
}
