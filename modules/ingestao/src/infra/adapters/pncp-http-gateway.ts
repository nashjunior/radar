import type {
  ArquivoPncpData,
  ContratacaoData,
  PncpGateway,
  PncpIdentificadorCompra,
} from '../../application/ports.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import { SsrfGuard, type SsrfGuardConfig } from './ssrf-guard.js';

/**
 * URL base da API pública de CONSULTA do PNCP (contratações, detalhe). Confirmada contra o
 * OpenAPI oficial (2026-07-11) — ver `arquitetura/02` §2.
 */
const BASE_URL = 'https://pncp.gov.br/api/consulta';

/**
 * URL base da API de DADOS do PNCP — arquivos/anexos vivem aqui, não em `/api/consulta`
 * (confirmado 2026-07-11; era o bug do item 4 de RAD-198).
 */
const ARQUIVOS_BASE_URL = 'https://pncp.gov.br/api/pncp';

/** Teto de registros por página: 10–50, confirmado (2026-07-11). */
const TAMANHO_PAGINA = 50;

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
    identificador: PncpIdentificadorCompra,
    signal: AbortSignal,
  ): Promise<ContratacaoData | null> {
    // Não existe GET /v1/contratacoes/{numeroControle} na API real — o único detalhe
    // individual é por cnpj/ano/sequencial (confirmado contra o OpenAPI oficial, 2026-07-11).
    const url = `${BASE_URL}${caminhoDaCompra(identificador)}`;
    const resposta = await this.fetchComRetry(url, signal);
    if (resposta.status === 404) return null;
    const json = await resposta.json() as unknown;
    return traduzirContratacao(json as PncpContratacaoRaw);
  }

  async buscarArquivos(
    identificador: PncpIdentificadorCompra,
    signal: AbortSignal,
  ): Promise<ArquivoPncpData[]> {
    // Arquivos vivem na API de DADOS (/api/pncp), não em /api/consulta — confirmado
    // 2026-07-11 (era o bug do item 4 de RAD-198).
    const url = `${ARQUIVOS_BASE_URL}${caminhoDaCompra(identificador)}/arquivos`;
    const resposta = await this.fetchComRetry(url, signal);
    const json = await resposta.json() as unknown;
    if (!Array.isArray(json)) {
      throw new SchemaDriftError('arquivos', 'resposta de /arquivos não é um array');
    }
    // [A VALIDAR — Swagger] Só o endpoint/base de /arquivos foi confirmado por chamada real
    // nesta verificação (2026-07-11) — o corpo de cada item, não. Nomes de campo abaixo são
    // best-effort pela convenção do resto da API (uri do arquivo, título do documento);
    // tamanhoBytes/tipoMime não aparecem nesse endpoint tipicamente — confirmar e ajustar
    // antes de operar contra o PNCP real (mesmo tratamento do restante do arquivo: falha
    // aberta/loud via SchemaDriftError quando falta o essencial, nunca grava lixo).
    return (json as PncpArquivoRaw[]).map((raw) => {
      const urlOrigem = raw.uri ?? raw.url;
      if (!urlOrigem) {
        throw new SchemaDriftError('arquivos[].uri', 'item de /arquivos sem URL de origem');
      }
      return {
        nome: raw.titulo ?? raw.nomeArquivo ?? urlOrigem.split('/').pop() ?? 'arquivo',
        urlOrigem,
        tamanhoBytes: 0,
        tipoMime: 'application/octet-stream',
      };
    });
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
        // 404 não é falha transiente de fonte — é resposta válida ("compra não encontrada"),
        // que buscarContratacaoPorNumero trata como null. Lançar aqui tornaria esse caminho
        // morto (bug encontrado pelo teste de RAD-198: 404 nunca chegava ao chamador).
        if (!resp.ok && resp.status !== 404) {
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

/**
 * Path do único endpoint de detalhe individual real: `GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`
 * (`/arquivos` é o mesmo path + sufixo). Não existe `/v1/contratacoes/{numeroControle}` na API real.
 */
function caminhoDaCompra(identificador: PncpIdentificadorCompra): string {
  return `/v1/orgaos/${encodeURIComponent(identificador.cnpj)}/compras/` +
    `${identificador.anoCompra}/${identificador.sequencialCompra}`;
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

interface PncpContratacaoRaw {
  numeroControlePNCP: string;
  anoCompra: number;
  sequencialCompra: number;
  modalidadeId: number;
  modalidadeNome: string;
  situacaoCompraNome: string;
  objetoCompra: string;
  valorTotalEstimado?: number | null;
  dataEncerramentoProposta?: string | null;
  dataPublicacaoPncp: string;
  dataAtualizacao: string;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  unidadeOrgao: { ufSigla: string; municipioNome: string };
  itens?: Array<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado?: number | null;
  }>;
}

/**
 * [A VALIDAR — Swagger] Corpo de cada item de `/arquivos` não confirmado por chamada real
 * (só o endpoint/base foram, 2026-07-11) — nomes best-effort pela convenção do resto da API.
 */
interface PncpArquivoRaw {
  uri?: string;
  url?: string;
  titulo?: string;
  nomeArquivo?: string;
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

/** Tradução PNCP → canônico. Minimização: PII desnecessária não é mapeada. */
function traduzirContratacao(raw: PncpContratacaoRaw): ContratacaoData {
  return {
    numeroControlePncp: raw.numeroControlePNCP,
    anoCompra: raw.anoCompra,
    sequencialCompra: raw.sequencialCompra,
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
      // UF em sigla (2 letras), não nome por extenso — consumido pelo filtro de
      // Matching (regiaoUf) via evento cross-context edital.ingerido (RAD-198 item 3).
      uf: raw.unidadeOrgao.ufSigla,
      municipio: raw.unidadeOrgao.municipioNome,
    },
    itens: (raw.itens ?? []).map(i => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado ?? null,
    })),
  };
}
