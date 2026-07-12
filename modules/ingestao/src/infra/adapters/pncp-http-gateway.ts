import type {
  ArquivoBaixado,
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
    // Documento revogado/substituído (statusAtivo:false) não entra na triagem (arq/02 §6.1).
    return (json as PncpArquivoRaw[]).map(traduzirArquivo).filter((arquivo) => arquivo.statusAtivo);
  }

  async downloadArquivo(urlOrigem: string, signal: AbortSignal): Promise<ArquivoBaixado> {
    // Guarda SSRF (P-58): valida URL e segue redirects com revalidação por hop.
    // A URL vem do PNCP (dado não confiável — arq/11) e pode apontar para IPs internos.
    const resposta = await this.ssrfGuard.fetch(urlOrigem, signal);
    if (!resposta.ok) {
      throw new FonteIndisponivelError('PNCP', `HTTP ${resposta.status} ao baixar anexo`);
    }
    const conteudo = new Uint8Array(await resposta.arrayBuffer());
    const contentLength = resposta.headers.get('content-length');
    return {
      conteudo,
      tamanhoBytes: contentLength !== null ? Number(contentLength) : conteudo.byteLength,
      // O PNCP declara application/octet-stream para tudo — mime real vem de sniff (arq/02 §6.1).
      tipoMime: detectarTipoMimePorMagicBytes(conteudo),
      nomeArquivo: extrairNomeDoContentDisposition(resposta.headers.get('content-disposition')),
    };
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
 * Corpo de cada item de `/arquivos` — confirmado por chamada real (arq/02 §6.1, RAD-274).
 * `tamanhoBytes`/`tipoMime`/nome real do arquivo não existem aqui — só no download.
 */
interface PncpArquivoRaw {
  uri?: string;
  url?: string;
  titulo?: string;
  sequencialDocumento?: number;
  tipoDocumentoId?: number;
  tipoDocumentoNome?: string;
  statusAtivo?: boolean;
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

/**
 * Tradução PNCP → canônico. Todos os campos são obrigatórios (100% presentes na
 * amostra real, arq/02 §6.1) — ausência é schema drift, falha loud, nunca grava lixo.
 */
function traduzirArquivo(raw: PncpArquivoRaw): ArquivoPncpData {
  const urlOrigem = raw.uri ?? raw.url;
  if (!urlOrigem) {
    throw new SchemaDriftError('arquivos[].uri', 'item de /arquivos sem URL de origem');
  }
  const { titulo, sequencialDocumento, tipoDocumentoId, tipoDocumentoNome, statusAtivo } = raw;
  if (typeof titulo !== 'string') {
    throw new SchemaDriftError('arquivos[].titulo', 'item de /arquivos sem titulo');
  }
  if (typeof sequencialDocumento !== 'number' || sequencialDocumento <= 0) {
    throw new SchemaDriftError('arquivos[].sequencialDocumento', 'item de /arquivos sem sequencialDocumento');
  }
  if (typeof tipoDocumentoId !== 'number') {
    throw new SchemaDriftError('arquivos[].tipoDocumentoId', 'item de /arquivos sem tipoDocumentoId');
  }
  if (typeof tipoDocumentoNome !== 'string') {
    throw new SchemaDriftError('arquivos[].tipoDocumentoNome', 'item de /arquivos sem tipoDocumentoNome');
  }
  if (typeof statusAtivo !== 'boolean') {
    throw new SchemaDriftError('arquivos[].statusAtivo', 'item de /arquivos sem statusAtivo');
  }
  return { titulo, urlOrigem, sequencialDocumento, tipoDocumentoId, tipoDocumentoNome, statusAtivo };
}

/**
 * Sniff por magic bytes — o PNCP declara `content-type: application/octet-stream` para
 * todo download, então o mime declarado não é fonte confiável (arq/02 §6.1). DOCX é um
 * ZIP por dentro; diferenciar os dois fica a cargo do extrator multi-formato (P-110).
 */
function detectarTipoMimePorMagicBytes(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  ) {
    return 'application/zip';
  }
  return 'application/octet-stream';
}

/** Nome real do arquivo (com extensão) do header `content-disposition`. Só existe no download. */
function extrairNomeDoContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const comAspas = /filename="([^"]+)"/i.exec(header);
  if (comAspas?.[1]) return comAspas[1];
  const rfc5987 = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (rfc5987?.[1]) {
    try {
      return decodeURIComponent(rfc5987[1].trim());
    } catch {
      return rfc5987[1].trim();
    }
  }
  const semAspas = /filename=([^;]+)/i.exec(header);
  if (semAspas?.[1]) return semAspas[1].trim();
  return null;
}
