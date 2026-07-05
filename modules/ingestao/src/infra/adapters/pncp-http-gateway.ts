import type {
  ArquivoPncpData,
  ContratacaoData,
  PncpGateway,
} from '../../application/ports.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';

/** URL base da API pública de consulta do PNCP. [A VALIDAR — Swagger] */
const BASE_URL = 'https://pncp.gov.br/api/consulta';

/** Teto de registros por página. [A VALIDAR — documentar no Swagger] */
const TAMANHO_PAGINA = 50;

/**
 * Adaptador HTTP para a API pública do PNCP — implementa o ACL.
 * Traduz o JSON externo para o modelo canônico; PII desnecessária é descartada aqui (A02, §4).
 * Inclui retry com backoff exponencial e detecção de schema drift.
 */
export class PncpHttpGateway implements PncpGateway {
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
    // TODO: confirmar endpoint no Swagger — forma esperada abaixo [A VALIDAR]
    const url = `${BASE_URL}/v1/contratacoes/${encodeURIComponent(numeroControlePncp)}`;
    const resposta = await this.fetchComRetry(url, signal);
    if (resposta.status === 404) return null;
    const json = await resposta.json() as unknown;
    return traduzirContratacao(json as PncpContratacaoRaw);
  }

  async buscarArquivos(
    numeroControlePncp: string,
    signal: AbortSignal,
  ): Promise<ArquivoPncpData[]> {
    // TODO: derivar cnpj/ano/sequencial do numeroControlePncp e montar o path correto
    // Endpoint esperado: GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos [A VALIDAR]
    void numeroControlePncp;
    void signal;
    throw new Error('buscarArquivos: não implementado — aguardando confirmação do endpoint no Swagger');
  }

  async downloadArquivo(urlOrigem: string, signal: AbortSignal): Promise<Uint8Array> {
    const resposta = await this.fetchComRetry(urlOrigem, signal);
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

interface PncpContratacaoRaw {
  numeroControlePNCP: string;
  modalidade: { codigo: number; nome: string };
  situacaoCompraNome: string;
  objetoCompra: string;
  valorTotalEstimado?: number | null;
  dataEncerramentoProposta?: string | null;
  dataPublicacaoPncp: string;
  dataAtualizacao: string;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  unidadeOrgao: { ufNome: string; municipioNome: string };
  itens?: Array<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado?: number | null;
  }>;
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
    modalidadeCodigo: raw.modalidade.codigo,
    modalidadeNome: raw.modalidade.nome,
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
      uf: raw.unidadeOrgao.ufNome,
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
