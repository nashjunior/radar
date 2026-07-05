import type { EditalId } from '@radar/kernel';

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

/**
 * Publicado pela Ingestão após upsert bem-sucedido.
 * Consumidores: Matching, Triagem, Inteligência (A03, §3 — Published Language).
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
