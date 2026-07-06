import type { EditalId } from '@radar/kernel';
import type { Edital } from '../domain/entities/edital.js';
import type { AnexosDTO, ArquivoDTO } from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Tipos do ACL — o modelo do PNCP não vaza além deste arquivo (docs/13, §5)
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
  orgao: {
    cnpj: string;
    nome: string;
    uf: string;
    municipio: string;
  };
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
// Ports de saída (implementados na infra/) — nomenclatura por papel (A10, §8)
// ---------------------------------------------------------------------------

/**
 * ACL do PNCP: traduz o modelo externo para o canônico.
 * Rate-limit, backoff exponencial e detecção de schema drift vivem na infra.
 * Coleta somente via API oficial (docs/02, §4; A02, §1).
 */
export interface PncpGateway {
  /** Itera páginas de contratações publicadas no intervalo de datas. */
  buscarContratacoesPorPublicacao(
    modalidade: number,
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]>;

  /** Itera páginas de contratações atualizadas no intervalo de datas. */
  buscarContratacoesPorAtualizacao(
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]>;

  /** Busca uma contratação específica pelo número de controle. */
  buscarContratacaoPorNumero(
    numeroControlePncp: string,
    signal: AbortSignal,
  ): Promise<ContratacaoData | null>;

  /** Lista metadados dos arquivos/anexos de uma contratação. */
  buscarArquivos(
    numeroControlePncp: string,
    signal: AbortSignal,
  ): Promise<ArquivoPncpData[]>;

  /** Baixa o conteúdo binário de um arquivo pelo URL de origem. */
  downloadArquivo(urlOrigem: string, signal: AbortSignal): Promise<Uint8Array>;
}

/** Repositório do agregado Edital. Upsert idempotente por `numeroControlePNCP`. */
export interface EditalRepository {
  /** Upsert por `numeroControlePNCP` — seguro para retry (A02, §3). */
  upsertPorNumeroControle(edital: Edital, signal: AbortSignal): Promise<void>;
  porId(id: EditalId, signal: AbortSignal): Promise<Edital | null>;
  porNumeroControle(
    numeroPncp: string,
    signal: AbortSignal,
  ): Promise<Edital | null>;
  /** Itera páginas de editais cujo `dataPublicacao` está na janela. */
  listarPorJanelaPublicacao(
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<Edital[]>;
}

/**
 * Persistência de proveniência — Open Host da Governança (docs/13, §5).
 * Gravada em todo edital ingerido (docs/02, §4; docs/05, §5).
 */
export interface ProvenienciaRepository {
  registrar(
    params: {
      editalId: EditalId;
      fonte: string;
      baseLegal: string;
      coletadoEm: Date;
    },
    signal: AbortSignal,
  ): Promise<void>;
}

/** Publicação de eventos de domínio na fila (Published Language — A03, §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/** Object storage para anexos (PDFs/documentos). Referência em A02, §6. */
export interface ObjectStorage {
  armazenar(
    chave: string,
    conteudo: Uint8Array,
    metadados: { contentType: string },
    signal: AbortSignal,
  ): Promise<string>;

  /** Leitura de bytes por chave. Usado internamente pelo adapter de DocumentosDoEditalPort. */
  obter(chave: string, signal: AbortSignal): Promise<Uint8Array>;

  /** Exclusão por chave. Necessário para retenção/expurgo (RAD-101, P-30, LGPD). */
  deletar(chave: string, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs únicos (UUID v4). Injetado na infra para isolabilidade. */
export interface IdProvider {
  gerar(): EditalId;
}

/**
 * Persistência de metadados de anexos materializados (docs/13, §5).
 * Guarda nome, storage key, MIME e tamanho após o primeiro download.
 * Upsert idempotente por (edital_id, nome).
 */
export interface AnexoEditalRepository {
  listarPorEdital(editalId: EditalId, signal: AbortSignal): Promise<ArquivoDTO[]>;
  salvar(editalId: EditalId, arquivos: ArquivoDTO[], signal: AbortSignal): Promise<void>;
}

/**
 * Open-Host Service de leitura de documentos da Ingestão (docs/13, §5).
 * Materializa os anexos na primeira chamada e retorna refs idempotentemente.
 * Consumidores externos (Triagem) recebem somente AnexosDTO — sem vazar modelo PNCP.
 */
export interface DocumentosDoEditalPort {
  obterDocumentos(editalId: EditalId, signal: AbortSignal): Promise<AnexosDTO>;
}
