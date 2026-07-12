import { createHash, randomUUID } from 'node:crypto';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { ContratacaoData } from '@radar/ingestao';
import { PncpHttpGateway } from '@radar/ingestao/infra';
import {
  PerfilHabilitacao,
  Triagem,
  type EntradaExtracaoDTO,
  type PerfilHabilitacaoProps,
} from '@radar/triagem';
import {
  AnthropicLlmGateway,
  GeminiLlmClient,
} from '@radar/triagem/infra';
import { filtrarContratacoes, lerFiltroDoEnv, type FiltroDemo } from './filtro.js';

/** Modalidades A02 §3 — todas (1–13). */
export const MODALIDADES_PNCP: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
];

export interface DemoConfig {
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly maxEditais: number;
  readonly janelaDias: number;
  readonly triarMax: number;
  readonly filtro: FiltroDemo;
  readonly perfil: PerfilHabilitacao;
  readonly tenantId: TenantId;
}

export interface ResultadoTriagemDemo {
  readonly contratacao: ContratacaoData;
  readonly editalId: string;
  readonly recomendacao: 'go' | 'no-go' | null;
  readonly aderencia: number | null;
  readonly objetoExtraido: string | null;
  readonly confianca: number | null;
  readonly riscos: readonly string[];
  readonly erro: string | null;
}

export interface LoteDemo {
  readonly coletados: ContratacaoData[];
  readonly filtrados: ContratacaoData[];
  readonly triagens: ResultadoTriagemDemo[];
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig {
  if (env['NODE_ENV'] === 'production') {
    throw new Error('@radar/local-demo é proibido em NODE_ENV=production.');
  }
  const geminiApiKey = env['GEMINI_API_KEY']?.trim();
  if (!geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY ausente. Copie tools/local-demo/.env.example → .env e preencha a chave.',
    );
  }

  const maxEditais = inteiroPositivo(env['DEMO_MAX_EDITAIS'], 20);
  const janelaDias = inteiroPositivo(env['DEMO_JANELA_DIAS'], 7);
  const triarMax = inteiroPositivo(env['DEMO_TRIAR_MAX'], 3);

  return {
    geminiApiKey,
    geminiModel: env['GEMINI_MODEL']?.trim() || 'gemini-2.0-flash',
    maxEditais,
    janelaDias,
    triarMax,
    filtro: lerFiltroDoEnv(env),
    perfil: carregarPerfil(env),
    tenantId: TenantId(env['DEMO_TENANT_ID']?.trim() || 'tenant-local-demo'),
  };
}

function carregarPerfil(env: NodeJS.ProcessEnv): PerfilHabilitacao {
  const raw = env['DEMO_PERFIL_JSON']?.trim();
  const base = {
    id: PerfilId(env['DEMO_PERFIL_ID']?.trim() || '22222222-2222-4222-8222-222222222222'),
    clienteFinalId: ClienteFinalId(
      env['DEMO_CLIENTE_FINAL_ID']?.trim() || '11111111-1111-4111-8111-111111111111',
    ),
    habJuridica: ['certidao negativa', 'cnpj regular', 'contrato social'],
    habFiscal: ['certidao federal', 'certidao estadual', 'fgts', 'inss'],
    habTecnica: ['atestado de capacidade tecnica'],
    habEconomica: ['balanco patrimonial', 'capital social'],
  };

  if (!raw) return PerfilHabilitacao.de(base);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('DEMO_PERFIL_JSON: JSON inválido.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('DEMO_PERFIL_JSON: esperado objeto.');
  }
  const o = parsed as Record<string, unknown>;
  const props: PerfilHabilitacaoProps = {
    id: base.id,
    clienteFinalId: base.clienteFinalId,
    habJuridica: listaStr(o['habJuridica'], base.habJuridica),
    habFiscal: listaStr(o['habFiscal'], base.habFiscal),
    habTecnica: listaStr(o['habTecnica'], base.habTecnica),
    habEconomica: listaStr(o['habEconomica'], base.habEconomica),
  };
  return PerfilHabilitacao.de(props);
}

function listaStr(v: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(v)) return fallback;
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function inteiroPositivo(raw: string | undefined, padrao: number): number {
  if (!raw?.trim()) return padrao;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.floor(n);
}

/** Coleta PNCP (modalidades 1–13) até `maxEditais`, aplica filtro e tria até `triarMax` com Gemini. */
export async function executarPipeline(
  config: DemoConfig,
  signal: AbortSignal = AbortSignal.timeout(120_000),
): Promise<LoteDemo> {
  const gateway = new PncpHttpGateway();
  const fim = new Date();
  const inicio = new Date(fim.getTime() - config.janelaDias * 24 * 60 * 60 * 1000);

  const coletados: ContratacaoData[] = [];
  for (const modalidade of MODALIDADES_PNCP) {
    if (coletados.length >= config.maxEditais) break;
    try {
      for await (const pagina of gateway.buscarContratacoesPorPublicacao(
        modalidade,
        { inicio, fim },
        signal,
      )) {
        for (const item of pagina) {
          coletados.push(item);
          if (coletados.length >= config.maxEditais) break;
        }
        if (coletados.length >= config.maxEditais) break;
        // Uma página por modalidade basta no demo (rate-limit educado).
        break;
      }
    } catch (err) {
      console.warn(
        `[local-demo] modalidade ${modalidade} falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const filtrados = filtrarContratacoes(coletados, config.filtro);
  const aTriar = filtrados.slice(0, config.triarMax);

  const llm = new AnthropicLlmGateway(
    new GeminiLlmClient({
      apiKey: config.geminiApiKey,
      modelo: config.geminiModel,
      nodeEnv: process.env['NODE_ENV'] ?? 'development',
    }),
  );

  const triagens: ResultadoTriagemDemo[] = [];
  for (const c of aTriar) {
    const editalId = idEstavelDePncp(c.numeroControlePncp);
    const entrada = contratacaoParaEntrada(c, editalId);
    try {
      const extracao = await llm.extrair(entrada, signal);
      const triagem = Triagem.avaliar(extracao, config.perfil, config.tenantId);
      triagens.push({
        contratacao: c,
        editalId,
        recomendacao: triagem.recomendacao,
        aderencia: triagem.aderencia?.valor ?? null,
        objetoExtraido: String(extracao.objeto.valor),
        confianca: extracao.confiancaGlobal().valor,
        riscos: triagem.riscos.map((r) => r.descricao),
        erro: null,
      });
    } catch (err) {
      triagens.push({
        contratacao: c,
        editalId,
        recomendacao: null,
        aderencia: null,
        objetoExtraido: null,
        confianca: null,
        riscos: [],
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { coletados, filtrados, triagens };
}

export function contratacaoParaEntrada(
  c: ContratacaoData,
  editalId: string = idEstavelDePncp(c.numeroControlePncp),
): EntradaExtracaoDTO {
  const itens =
    c.itens.length > 0
      ? c.itens
          .map(
            (i) =>
              `Item ${i.numeroItem}: ${i.descricao}` +
              (i.quantidade ? ` (qtd ${i.quantidade})` : '') +
              (i.valorUnitarioEstimado != null ? ` R$ ${i.valorUnitarioEstimado}` : ''),
          )
          .join('\n')
      : '';
  const texto = [
    `Número PNCP: ${c.numeroControlePncp}`,
    `Modalidade: ${c.modalidadeNome} (código ${c.modalidadeCodigo})`,
    `Fase: ${c.faseAtual}`,
    `Órgão: ${c.orgao.nome} — ${c.orgao.municipio}/${c.orgao.uf} (CNPJ ${c.orgao.cnpj})`,
    `Objeto: ${c.objeto}`,
    c.valorEstimado != null ? `Valor estimado: R$ ${c.valorEstimado}` : 'Valor estimado: não informado',
    c.prazoProposta
      ? `Prazo de proposta: ${c.prazoProposta.toISOString()}`
      : 'Prazo de proposta: não informado',
    `Publicação: ${c.dataPublicacao.toISOString()}`,
    itens ? `Itens:\n${itens}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');

  return {
    editalId,
    texto,
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 1,
  };
}

export function idEstavelDePncp(numeroControlePncp: string): string {
  const hash = createHash('sha256').update(numeroControlePncp).digest('hex').slice(0, 32);
  return EditalId(
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
  );
}

export function resumoLoteParaChat(lote: LoteDemo): string {
  const linhas = lote.filtrados.slice(0, 30).map((c) => {
    const tri = lote.triagens.find((t) => t.contratacao.numeroControlePncp === c.numeroControlePncp);
    const rec = tri?.recomendacao ? ` recomendacao=${tri.recomendacao}` : '';
    const ad = tri?.aderencia != null ? ` aderencia=${tri.aderencia.toFixed(2)}` : '';
    return (
      `- ${c.numeroControlePncp} | mod=${c.modalidadeCodigo} ${c.modalidadeNome} | ` +
      `${c.orgao.uf} | valor=${c.valorEstimado ?? 'n/d'} | ${c.objeto.slice(0, 180)}${rec}${ad}`
    );
  });
  return linhas.join('\n') || '(nenhum edital filtrado)';
}

/** Garante UUID-like único quando necessário (não usado no hash estável). */
export function novoId(): string {
  return randomUUID();
}
