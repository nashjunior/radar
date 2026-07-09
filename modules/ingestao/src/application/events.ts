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
      /** Proveniência do edital: origem, base legal e data de coleta (RAD-115). */
      readonly proveniencia?: {
        readonly fonte: string;
        readonly baseLegal: string;
        /** ISO-8601 — data em que o edital foi coletado do PNCP. */
        readonly dataColeta: string;
      };
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado quando um anexo é armazenado e entra em quarentena.
 * Dispara o worker de scan AV/malware (P-104, AB14).
 */
export class AnexoQuarentenado implements DomainEvent {
  readonly type = 'anexo.quarentenado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly nomeAnexo: string;
      readonly storageKey: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Publicado quando o scan AV aprova o anexo como limpo (P-104, AB14). */
export class AnexoAprovado implements DomainEvent {
  readonly type = 'anexo.aprovado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly nomeAnexo: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Publicado quando o scan AV detecta ameaça e isola o anexo (P-104, AB14). */
export class AnexoRejeitado implements DomainEvent {
  readonly type = 'anexo.rejeitado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly nomeAnexo: string;
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
