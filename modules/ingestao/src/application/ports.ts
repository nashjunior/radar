import type { EditalId } from '@radar/kernel';
import type { Edital } from '../domain/entities/edital.js';
import type { EstadoConfiancaAnexo } from '../domain/value-objects/estado-confianca-anexo.js';
import type { AnexosDTO, ArquivoDTO } from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Tipos do ACL — o modelo do PNCP não vaza além deste arquivo (docs/13, §5)
// ---------------------------------------------------------------------------

export interface ContratacaoData {
  numeroControlePncp: string;
  /** Ano da compra no PNCP — chave (com cnpj/sequencialCompra) do endpoint de detalhe/arquivos. */
  anoCompra: number;
  /** Sequencial da compra no PNCP — idem. Nunca derivar de numeroControlePncp (formato irregular). */
  sequencialCompra: number;
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

/**
 * Identifica uma compra para os endpoints de detalhe/arquivos do PNCP
 * (`GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}[/arquivos]`). Vem sempre de um
 * `ContratacaoData`/`Edital` já carregado — nunca parseado de `numeroControlePncp`
 * (formato irregular, ex.: `80881915000192-1-000044/2026`).
 */
export interface PncpIdentificadorCompra {
  cnpj: string;
  anoCompra: number;
  sequencialCompra: number;
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

  /** Busca uma contratação específica pelo identificador (cnpj/ano/sequencial). */
  buscarContratacaoPorNumero(
    identificador: PncpIdentificadorCompra,
    signal: AbortSignal,
  ): Promise<ContratacaoData | null>;

  /** Lista metadados dos arquivos/anexos de uma contratação. */
  buscarArquivos(
    identificador: PncpIdentificadorCompra,
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
 * Metadados internos de um anexo — inclui estado de confiança (P-104, AB14).
 * Não vaza para consumidores; estes recebem apenas `ArquivoDTO` (sempre limpos).
 */
export interface AnexoMetadados extends ArquivoDTO {
  estadoConfianca: EstadoConfiancaAnexo;
}

/**
 * Scanner AV/malware assíncrono de anexos (P-104, AB14).
 * Implementação real usa ClamAV/Lambda ou serviço equivalente;
 * o stub de MVP aprova todos para não bloquear o fluxo de dev.
 */
export interface AnexoScanner {
  escanear(storageKey: string, signal: AbortSignal): Promise<'limpo' | 'rejeitado'>;
}

/**
 * Persistência de metadados de anexos materializados (docs/13, §5).
 * Inclui estado de confiança para o trust-gating (P-104, AB14).
 * Upsert idempotente por (edital_id, sequencial_documento) — nunca por `nome`,
 * texto livre do órgão que pode se repetir entre documentos distintos (RAD-291).
 */
export interface AnexoEditalRepository {
  /** Retorna todos os anexos com seu estado de confiança (uso interno). */
  listarPorEdital(editalId: EditalId, signal: AbortSignal): Promise<AnexoMetadados[]>;
  /** Upsert de metadados — salva com estadoConfianca incluso. */
  salvar(editalId: EditalId, arquivos: AnexoMetadados[], signal: AbortSignal): Promise<void>;
  /** Transiciona o estado de confiança de um anexo (pendente → limpo | rejeitado). */
  atualizarEstado(
    editalId: EditalId,
    sequencialDocumento: number,
    estado: EstadoConfiancaAnexo,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * Open-Host Service de leitura de documentos da Ingestão (docs/13, §5).
 * Materializa os anexos na primeira chamada e retorna refs idempotentemente.
 * Consumidores externos (Triagem) recebem somente AnexosDTO — sem vazar modelo PNCP.
 */
export interface DocumentosDoEditalPort {
  obterDocumentos(editalId: EditalId, signal: AbortSignal): Promise<AnexosDTO>;
}
