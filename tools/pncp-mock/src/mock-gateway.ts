/**
 * MockPncpGateway — implementação in-process do PncpGateway para stress tests.
 *
 * Substitui o PncpHttpGateway sem nenhuma rede: gera os dados de forma lazy
 * usando os perfis medidos em P-31 (PERFIL_DIA_UTIL_PUBLICACAO).
 * Compatível estruturalmente com PncpGateway de @radar/ingestao.
 *
 * Regra dura (A04 §4): nenhuma chamada à API pública do PNCP.
 */

import {
  gerarContratacaoRaw,
  MODALIDADES,
  PERFIL_DIA_UTIL_PUBLICACAO,
  TAMANHO_PAGINA_MAX,
  VOLUME_ATUALIZACOES_DIA_UTIL,
  type OpcoesGeracao,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Tipos espelho de @radar/ingestao/application/ports
// (redeclarados localmente para evitar dependência de build em tools/)
// ---------------------------------------------------------------------------

export interface ContratacaoData {
  numeroControlePncp: string;
  modalidadeCodigo: number;
  modalidadeNome: string;
  faseAtual: string;
  objeto: string;
  valorEstimado: number | null;
  prazoProposta: Date | null;
  dataPublicacao: Date;
  dataAtualizacao: Date;
  orgao: { cnpj: string; nome: string; uf: string; municipio: string };
  itens: ReadonlyArray<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado: number | null;
  }>;
}

export interface ArquivoPncpData {
  nome: string;
  urlOrigem: string;
  tamanhoBytes: number;
  tipoMime: string;
}

// ---------------------------------------------------------------------------
// Configuração do mock
// ---------------------------------------------------------------------------

/** Cenário de erro injetável por página e endpoint. */
export interface CenarioErro {
  /** undefined = todas as modalidades */
  modalidade?: number;
  /** Página (1-indexed) que dispara o erro */
  pagina: number;
  /** Código HTTP a simular */
  tipo: 422 | 429 | 500;
}

export interface MockPncpConfig {
  /**
   * Volume por modalidade (default = PERFIL_DIA_UTIL_PUBLICACAO — P-31).
   * Parcial: valores não especificados herdam o perfil.
   */
  volumePorModalidade?: Partial<Record<number, number>>;
  /** Total de atualizações/dia (default = 15.000 — P-31). */
  volumeAtualizacoes?: number;
  /** Se true, valorTotalEstimado e prazo ficam null (campos sigilosos). */
  camposSigilosos?: boolean;
  /** Cenários de erro para injetar — simula 422, 429, falha 5xx. */
  cenariosErro?: CenarioErro[];
  /** Data-base dos timestamps gerados (default: 2026-07-10T10:00:00Z). */
  dataBase?: Date;
}

// ---------------------------------------------------------------------------
// Implementação
// ---------------------------------------------------------------------------

/**
 * Mock in-process do PncpGateway.
 *
 * Estruturalmente compatível com `PncpGateway` de `@radar/ingestao`.
 * O harness de stress (RAD-162) pode usar:
 *
 *   const g: PncpGateway = new MockPncpGateway({ ... });
 *
 * e TypeScript verifica a compatibilidade no ponto de uso.
 */
export class MockPncpGateway {
  private readonly volume: Record<number, number>;
  private readonly volumeAtualizacoes: number;
  private readonly opts: OpcoesGeracao;
  private readonly erros: CenarioErro[];

  constructor(config: MockPncpConfig = {}) {
    this.volume = { ...PERFIL_DIA_UTIL_PUBLICACAO, ...config.volumePorModalidade } as Record<number, number>;
    this.volumeAtualizacoes = config.volumeAtualizacoes ?? VOLUME_ATUALIZACOES_DIA_UTIL;
    this.opts = {
      sigiloso: config.camposSigilosos ?? false,
      dataBase: config.dataBase ?? new Date('2026-07-10T10:00:00Z'),
    };
    this.erros = config.cenariosErro ?? [];
  }

  async *buscarContratacoesPorPublicacao(
    modalidade: number,
    _janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    const total = this.volume[modalidade] ?? 0;
    yield* this.gerarPaginas(total, modalidade, signal);
  }

  async *buscarContratacoesPorAtualizacao(
    _janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    yield* this.gerarPaginas(this.volumeAtualizacoes, undefined, signal);
  }

  async buscarContratacaoPorNumero(
    numeroControlePncp: string,
    _signal: AbortSignal,
  ): Promise<ContratacaoData | null> {
    if (!numeroControlePncp.trim()) return null;
    const raw = gerarContratacaoRaw(0, 6, this.opts);
    return traduzir({ ...raw, numeroControlePNCP: numeroControlePncp });
  }

  async buscarArquivos(
    _numeroControlePncp: string,
    _signal: AbortSignal,
  ): Promise<ArquivoPncpData[]> {
    return [
      {
        nome: 'edital.pdf',
        urlOrigem: 'https://pncp.gov.br/mock/edital.pdf',
        tamanhoBytes: 256_000,
        tipoMime: 'application/pdf',
      },
      {
        nome: 'termo-referencia.pdf',
        urlOrigem: 'https://pncp.gov.br/mock/tr.pdf',
        tamanhoBytes: 128_000,
        tipoMime: 'application/pdf',
      },
    ];
  }

  async downloadArquivo(_urlOrigem: string, _signal: AbortSignal): Promise<Uint8Array> {
    // Uint8Array com cabeçalho PDF mínimo (%PDF-1.4) — suficiente para smoke tests
    const bytes = new Uint8Array(1_024);
    bytes[0] = 0x25; // %
    bytes[1] = 0x50; // P
    bytes[2] = 0x44; // D
    bytes[3] = 0x46; // F
    bytes[4] = 0x2D; // -
    bytes[5] = 0x31; // 1
    bytes[6] = 0x2E; // .
    bytes[7] = 0x34; // 4
    return bytes;
  }

  // ---------------------------------------------------------------------------
  // Interno
  // ---------------------------------------------------------------------------

  private async *gerarPaginas(
    total: number,
    modalidade: number | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    const totalPaginas = total === 0 ? 1 : Math.ceil(total / TAMANHO_PAGINA_MAX);

    for (let pagina = 1; pagina <= totalPaginas; pagina++) {
      if (signal.aborted) return;

      this.verificarCenarioErro(pagina, modalidade);

      const inicio = (pagina - 1) * TAMANHO_PAGINA_MAX;
      const fim = Math.min(inicio + TAMANHO_PAGINA_MAX, total);
      const items: ContratacaoData[] = [];

      for (let i = inicio; i < fim; i++) {
        const raw = gerarContratacaoRaw(i, modalidade ?? 6, this.opts);
        items.push(traduzir(raw));
      }

      yield items;
    }
  }

  private verificarCenarioErro(pagina: number, modalidade?: number): void {
    const cenario = this.erros.find(
      e =>
        e.pagina === pagina &&
        (e.modalidade === undefined || e.modalidade === modalidade),
    );
    if (cenario === undefined) return;

    const descricao =
      cenario.tipo === 429
        ? 'rate limit excedido (mock P-32)'
        : cenario.tipo === 422
          ? 'parâmetro inválido (mock P-32)'
          : 'erro interno (mock P-32)';
    throw new MockHttpError(cenario.tipo, descricao);
  }
}

/** Erro que simula uma resposta HTTP de erro do PNCP. */
export class MockHttpError extends Error {
  constructor(
    readonly status: 422 | 429 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'MockHttpError';
  }
}

// ---------------------------------------------------------------------------
// Tradução raw → canônico (espelha traduzirContratacao do PncpHttpGateway)
// ---------------------------------------------------------------------------

function traduzir(raw: ReturnType<typeof gerarContratacaoRaw>): ContratacaoData {
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

// ---------------------------------------------------------------------------
// Helpers de factory (conveniência para os harnesses de stress)
// ---------------------------------------------------------------------------

/** Cria um gateway com o perfil de dia útil completo (P-31): ~5.800 publicações + 15.000 atualizações. */
export function criarGatewayDiaUtil(overrides?: Omit<MockPncpConfig, 'volumePorModalidade' | 'volumeAtualizacoes'>): MockPncpGateway {
  return new MockPncpGateway(overrides);
}

/** Cria um gateway com volume reduzido para testes rápidos: 1 página por modalidade dominante. */
export function criarGatewaySmoke(overrides?: MockPncpConfig): MockPncpGateway {
  return new MockPncpGateway({
    ...overrides,
    volumePorModalidade: { 6: 50, 8: 50, 9: 50 },
    volumeAtualizacoes: 50,
  });
}

/** Cria um gateway que retorna campos sigilosos (valorEstimado null, prazo null). */
export function criarGatewaySigiloso(): MockPncpGateway {
  return new MockPncpGateway({ camposSigilosos: true, volumePorModalidade: { 6: 10 }, volumeAtualizacoes: 0 });
}

/** Modalidades que cobrem ≥ 90 % do volume (P-31). */
export const MODALIDADES_DOMINANTES = [6, 8, 9] as const;

/** Todos os códigos de modalidade da Lei 14.133/2021. */
export const TODOS_MODALIDADES = Object.keys(MODALIDADES).map(Number) as number[];
