import type {
  ArquivoPncpData,
  ContratacaoData,
  PncpGateway,
} from '../../application/ports.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import { SsrfGuard, type SsrfGuardConfig } from './ssrf-guard.js';

/** URL base da API pública de consulta do PNCP. [A VALIDAR — Swagger] */
const BASE_URL = 'https://pncp.gov.br/api/consulta';

/**
 * Base da API PNCP para anexos (host distinto de `/api/consulta`).
 * Confirmado por chamada real: GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/arquivos
 */
const BASE_URL_ARQUIVOS = 'https://pncp.gov.br/api/pncp';

/** Teto de registros por página. [A VALIDAR — documentar no Swagger] */
const TAMANHO_PAGINA = 50;

/** Formato canônico: `{cnpj14}-{n}-{sequencial}/{ano}` (ex.: `88124961000159-1-000074/2026`). */
const RE_NUMERO_CONTROLE =
  /^(\d{14})-\d+-(\d+)\/(\d{4})$/;

/** Allowlist de egress padrão para o PNCP (P-58). Sobreposta via config em produção. */
const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['pncp.gov.br'];

/**
 * Adaptador HTTP para a API pública do PNCP — implementa o ACL.
 * Traduz o JSON externo para o modelo canônico; PII desnecessária é descartada aqui (A02, §4).
 * Inclui retry com backoff exponencial, detecção de schema drift e guarda SSRF (P-58).
 */
export class PncpHttpGateway implements PncpGateway {
  private readonly ssrfGuard: SsrfGuard;

  constructor(ssrfConfig?: Partial<SsrfGuardConfig>) {
    const base: SsrfGuardConfig = { allowedHosts: ssrfConfig?.allowedHosts ?? DEFAULT_ALLOWED_HOSTS };
    if (ssrfConfig?.maxRedirects !== undefined) base.maxRedirects = ssrfConfig.maxRedirects;
    this.ssrfGuard = new SsrfGuard(base);
  }
  async *buscarContratacoesPorPublicacao(
    modalidade: number,
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    let pagina = 1;
    let paginasRestantes = 1;

    while (paginasRestantes > 0) {
      const url = new URL(`${BASE_URL}/v1/contratacoes/publicacao`);
      url.searchParams.set('codigoModalidadeContratacao', String(modalidade));
      url.searchParams.set('dataInicial', formatarDataPncp(janela.inicio));
      url.searchParams.set('dataFinal', formatarDataPncp(janela.fim));
      url.searchParams.set('pagina', String(pagina));
      url.searchParams.set('tamanhoPagina', String(TAMANHO_PAGINA));

      const resposta = await this.fetchComRetry(url.toString(), signal);
      const json = await resposta.json() as unknown;
      const pagRaw = validarPaginacao(json);

      paginasRestantes = pagRaw.paginasRestantes;
      yield pagRaw.data.map(traduzirContratacao);
      pagina++;
    }
  }

  async *buscarContratacoesPorAtualizacao(
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    let pagina = 1;
    let paginasRestantes = 1;

    while (paginasRestantes > 0) {
      const url = new URL(`${BASE_URL}/v1/contratacoes/atualizacao`);
      url.searchParams.set('dataInicial', formatarDataPncp(janela.inicio));
      url.searchParams.set('dataFinal', formatarDataPncp(janela.fim));
      url.searchParams.set('pagina', String(pagina));
      url.searchParams.set('tamanhoPagina', String(TAMANHO_PAGINA));

      const resposta = await this.fetchComRetry(url.toString(), signal);
      const json = await resposta.json() as unknown;
      const pagRaw = validarPaginacao(json);

      paginasRestantes = pagRaw.paginasRestantes;
      yield pagRaw.data.map(traduzirContratacao);
      pagina++;
    }
  }

  async buscarContratacaoPorNumero(
    numeroControlePncp: string,
    signal: AbortSignal,
  ): Promise<ContratacaoData | null> {
    const { cnpj, ano, sequencial } = decomporNumeroControle(numeroControlePncp);
    const urlDetalhe = `${BASE_URL}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`;
    const urlItens =
      `${BASE_URL_ARQUIVOS}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens`;

    let detalheRaw: PncpContratacaoRaw;
    try {
      const resposta = await this.fetchComRetry(urlDetalhe, signal);
      detalheRaw = (await resposta.json()) as PncpContratacaoRaw;
    } catch (err) {
      if (err instanceof FonteIndisponivelError && /HTTP 404/.test(err.message)) {
        return null;
      }
      throw err;
    }

    const base = traduzirContratacao(detalheRaw);
    try {
      const respItens = await this.fetchComRetry(urlItens, signal);
      const json = (await respItens.json()) as unknown;
      if (!Array.isArray(json)) {
        throw new SchemaDriftError('itens', 'resposta não é array');
      }
      return { ...base, itens: json.map(traduzirItem) };
    } catch {
      // Detalhe sem itens ainda é útil (lista já pode ter metadados).
      return base;
    }
  }

  async buscarArquivos(
    numeroControlePncp: string,
    signal: AbortSignal,
  ): Promise<ArquivoPncpData[]> {
    const { cnpj, ano, sequencial } = decomporNumeroControle(numeroControlePncp);
    const url =
      `${BASE_URL_ARQUIVOS}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`;
    const resposta = await this.fetchComRetry(url, signal);
    const json = (await resposta.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new SchemaDriftError('arquivos', 'resposta não é array');
    }
    return json.map(traduzirArquivo);
  }

  async downloadArquivo(urlOrigem: string, signal: AbortSignal): Promise<Uint8Array> {
    // Guarda SSRF (P-58): valida URL e segue redirects com revalidação por hop.
    // A URL vem do PNCP (dado não confiável — arq/11) e pode apontar para IPs internos.
    const resposta = await this.ssrfGuard.fetch(urlOrigem, signal);
    if (!resposta.ok) {
      throw new FonteIndisponivelError('PNCP', `HTTP ${resposta.status} ao baixar anexo`);
    }
    return new Uint8Array(await resposta.arrayBuffer());
  }

  // ---------------------------------------------------------------------------
  // Infra interna
  // ---------------------------------------------------------------------------

  private async fetchComRetry(
    url: string,
    signal: AbortSignal,
    tentativas = 3,
  ): Promise<Response> {
    let ultimoErro: Error | undefined;

    for (let tentativa = 0; tentativa < tentativas; tentativa++) {
      try {
        const resp = await fetch(url, { signal });

        if (resp.status === 429 || resp.status >= 500) {
          await aguardar(1000 * 2 ** tentativa, signal);
          continue;
        }
        if (!resp.ok) {
          throw new FonteIndisponivelError('PNCP', `HTTP ${resp.status}`);
        }
        return resp;
      } catch (err) {
        if (err instanceof FonteIndisponivelError) throw err;
        if (isAbortError(err)) throw err;
        ultimoErro = err as Error;
        if (tentativa < tentativas - 1) {
          await aguardar(1000 * 2 ** tentativa, signal);
        }
      }
    }

    throw new FonteIndisponivelError('PNCP', ultimoErro?.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

function formatarDataPncp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function aguardar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('operação abortada', 'AbortError'));
      },
      { once: true },
    );
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

// ---------------------------------------------------------------------------
// Tipos do PNCP (apenas neste arquivo — não vazam para fora do ACL)
// ---------------------------------------------------------------------------

interface PncpPaginaRaw {
  data: PncpContratacaoRaw[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  paginasRestantes: number;
}

/**
 * Shape real da API de consulta (confirmado 2026-07-11): modalidade vem FLAT
 * (`modalidadeId` + `modalidadeNome`), não como objeto aninhado. UF útil para filtro
 * é `ufSigla` (ex.: "PR"); `ufNome` é o nome por extenso.
 */
interface PncpContratacaoRaw {
  numeroControlePNCP: string;
  modalidadeId: number;
  modalidadeNome: string;
  situacaoCompraNome: string;
  objetoCompra: string;
  valorTotalEstimado?: number | null;
  valorTotalHomologado?: number | null;
  dataAberturaProposta?: string | null;
  dataEncerramentoProposta?: string | null;
  dataPublicacaoPncp: string;
  dataAtualizacao: string;
  numeroCompra?: string | null;
  processo?: string | null;
  srp?: boolean;
  modoDisputaNome?: string | null;
  tipoInstrumentoConvocatorioNome?: string | null;
  informacaoComplementar?: string | null;
  linkSistemaOrigem?: string | null;
  linkProcessoEletronico?: string | null;
  usuarioNome?: string | null;
  amparoLegal?: { nome?: string; codigo?: number; descricao?: string } | null;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  unidadeOrgao: {
    ufNome: string;
    ufSigla?: string;
    municipioNome: string;
  };
  itens?: Array<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado?: number | null;
  }>;
}

interface PncpItemRaw {
  numeroItem?: number;
  descricao?: string;
  quantidade?: number;
  valorUnitarioEstimado?: number | null;
  valorTotal?: number | null;
  unidadeMedida?: string | null;
  criterioJulgamentoNome?: string | null;
  materialOuServicoNome?: string | null;
}

function validarPaginacao(json: unknown): PncpPaginaRaw {
  if (
    typeof json !== 'object' ||
    json === null ||
    !('data' in json) ||
    !Array.isArray((json as Record<string, unknown>)['data'])
  ) {
    throw new SchemaDriftError('root', 'resposta não contém campo "data" como array');
  }
  return json as PncpPaginaRaw;
}

/**
 * Extrai path params do numeroControlePNCP para o endpoint de arquivos.
 * O sequencial na URL não leva zeros à esquerda (ex.: `000074` → `74`).
 */
export function decomporNumeroControle(numero: string): {
  cnpj: string;
  ano: string;
  sequencial: string;
} {
  const m = RE_NUMERO_CONTROLE.exec(numero.trim());
  if (!m) {
    throw new SchemaDriftError(
      'numeroControlePNCP',
      `formato inesperado para anexos: '${numero}'`,
    );
  }
  return {
    cnpj: m[1]!,
    sequencial: String(Number(m[2])),
    ano: m[3]!,
  };
}

interface PncpArquivoRaw {
  titulo?: string;
  url?: string;
  uri?: string;
  sequencialDocumento?: number;
  tipoDocumentoNome?: string;
  statusAtivo?: boolean;
}

function traduzirArquivo(raw: unknown): ArquivoPncpData {
  const a = raw as PncpArquivoRaw;
  const urlOrigem = a.url ?? a.uri;
  if (!urlOrigem || typeof urlOrigem !== 'string') {
    throw new SchemaDriftError('arquivos.url', 'esperado url ou uri string');
  }
  const titulo =
    (typeof a.titulo === 'string' && a.titulo.trim()) ||
    (typeof a.tipoDocumentoNome === 'string' && a.tipoDocumentoNome.trim()) ||
    `documento-${a.sequencialDocumento ?? 'x'}`;
  return {
    nome: titulo.endsWith('.pdf') ? titulo : `${titulo}.pdf`,
    urlOrigem,
    // Lista de metadados não traz tamanho/MIME — preenchidos no download se necessário.
    tamanhoBytes: 0,
    tipoMime: 'application/pdf',
  };
}

function traduzirItem(raw: unknown): ContratacaoData['itens'][number] {
  const i = raw as PncpItemRaw;
  if (typeof i.numeroItem !== 'number' || typeof i.descricao !== 'string') {
    throw new SchemaDriftError('itens', 'esperado numeroItem + descricao');
  }
  return {
    numeroItem: i.numeroItem,
    descricao: i.descricao,
    quantidade: typeof i.quantidade === 'number' ? i.quantidade : 0,
    valorUnitarioEstimado: i.valorUnitarioEstimado ?? null,
    valorTotal: i.valorTotal ?? null,
    unidadeMedida: textoOuNull(i.unidadeMedida),
    criterioJulgamentoNome: textoOuNull(i.criterioJulgamentoNome),
    materialOuServicoNome: textoOuNull(i.materialOuServicoNome),
  };
}

/** Tradução PNCP → canônico. Minimização: PII desnecessária não é mapeada. */
function traduzirContratacao(raw: PncpContratacaoRaw): ContratacaoData {
  if (typeof raw.modalidadeId !== 'number' || typeof raw.modalidadeNome !== 'string') {
    throw new SchemaDriftError('modalidade', 'esperado modalidadeId (number) + modalidadeNome (string)');
  }
  if (!raw.orgaoEntidade || !raw.unidadeOrgao) {
    throw new SchemaDriftError('orgao', 'esperado orgaoEntidade + unidadeOrgao');
  }
  return {
    numeroControlePncp: raw.numeroControlePNCP,
    modalidadeCodigo: raw.modalidadeId,
    modalidadeNome: raw.modalidadeNome,
    faseAtual: raw.situacaoCompraNome,
    objeto: raw.objetoCompra,
    valorEstimado: raw.valorTotalEstimado ?? null,
    prazoProposta: raw.dataEncerramentoProposta
      ? new Date(raw.dataEncerramentoProposta)
      : null,
    dataPublicacao: new Date(raw.dataPublicacaoPncp),
    dataAtualizacao: new Date(raw.dataAtualizacao),
    orgao: {
      cnpj: raw.orgaoEntidade.cnpj,
      nome: raw.orgaoEntidade.razaoSocial,
      uf: raw.unidadeOrgao.ufSigla ?? raw.unidadeOrgao.ufNome,
      municipio: raw.unidadeOrgao.municipioNome,
    },
    itens: (raw.itens ?? []).map(i => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado ?? null,
    })),
    numeroCompra: textoOuNull(raw.numeroCompra),
    processo: textoOuNull(raw.processo),
    srp: raw.srp === true,
    modoDisputaNome: textoOuNull(raw.modoDisputaNome),
    amparoLegalNome: textoOuNull(raw.amparoLegal?.nome),
    dataAberturaProposta: raw.dataAberturaProposta
      ? new Date(raw.dataAberturaProposta)
      : null,
    informacaoComplementar: textoOuNull(raw.informacaoComplementar),
    linkSistemaOrigem: normalizarUrlExterna(raw.linkSistemaOrigem),
    linkProcessoEletronico: normalizarUrlExterna(raw.linkProcessoEletronico),
    valorHomologado: raw.valorTotalHomologado ?? null,
    tipoInstrumentoNome: textoOuNull(raw.tipoInstrumentoConvocatorioNome),
    plataformaPublicacao: textoOuNull(raw.usuarioNome),
  };
}

function textoOuNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Aceita URL absoluta ou host sem scheme (`www.…`). */
function normalizarUrlExterna(v: string | null | undefined): string | null {
  const t = textoOuNull(v);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}([/:].*)?$/i.test(t)) return `https://${t}`;
  return t;
}
