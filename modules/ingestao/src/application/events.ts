import type { EditalId } from '@radar/kernel';

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

/**
 * Publicado pela Ingestão após upsert bem-sucedido.
 * Consumidores: Matching, Triagem, Inteligência (A03, §3 — Published Language).
 *
 * Snapshot de atributos normalizados incluído para que consumidores (Matching, Triagem)
 * não precisem fazer leitura cross-contexto do DB da Ingestão (docs/13 §4-5, P-97).
 */
export class EditalIngerido implements DomainEvent {
  readonly type = 'edital.ingerido' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly numeroControlePncp: string;
      readonly modalidadeCodigo: number;
      readonly faseAtual: string;
      readonly dataAtualizacao: Date;
      /** Objeto da contratação — necessário para matching por palavras-chave. */
      readonly objeto: string;
      /** UF do órgão contratante. */
      readonly orgaoUf: string;
      /** Valor estimado em reais. null quando não informado no edital. */
      readonly valorEstimado: number | null;
      /** Data de publicação original no PNCP. */
      readonly dataPublicacao: Date;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Publicado quando a fase de um edital muda na reconciliação ou atualização. */
export class EditalFaseMudou implements DomainEvent {
  readonly type = 'edital.fase-mudou' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly numeroControlePncp: string;
      readonly faseAnterior: string;
      readonly faseAtual: string;
      readonly dataAtualizacao: Date;
    },
  ) {
    this.occurredAt = new Date();
  }
}
