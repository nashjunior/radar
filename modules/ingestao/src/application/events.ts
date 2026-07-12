import type { DomainEvent, EditalId } from '@radar/kernel';

export type { DomainEvent };

// ---------------------------------------------------------------------------
// Estado dos circuit breakers (P-34)
// ---------------------------------------------------------------------------

export type EstadoBreaker = 'FECHADO' | 'ABERTO' | 'MEIO_ABERTO';

// ---------------------------------------------------------------------------
// Eventos de observabilidade do pipeline (P-15 · docs/08 §6 · docs/12 §5)
// Schema versionado: campo `schemaVersion` garante evolução sem quebra.
// ---------------------------------------------------------------------------

/**
 * Emitido após cada ciclo de polling, por regime.
 * Mede frescor (duracaoMs), cobertura (ingeridos/atualizados/erros) e saúde do breaker.
 */
export class PipelineCicloConcluido implements DomainEvent {
  readonly type = 'pipeline.ciclo.concluido' as const;
  readonly schemaVersion = '1.0' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly regime: 'publicacao' | 'atualizacao' | 'reconciliacao';
      readonly modalidades: readonly number[];
      readonly janela: { readonly inicio: string; readonly fim: string };
      readonly ingeridos: number;
      readonly atualizados: number;
      readonly erros: number;
      readonly duracaoMs: number;
      readonly breakerAberto: boolean;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Emitido em toda transição de estado de circuit breaker (arq/04 §7).
 * Consumido pelo Source-Health Monitor para alarmes/SLO (P-34).
 */
export class PipelineBreakerEstadoMudou implements DomainEvent {
  readonly type = 'pipeline.breaker.estado-mudou' as const;
  readonly schemaVersion = '1.0' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly breaker: string;
      readonly estadoAnterior: EstadoBreaker;
      readonly estadoAtual: EstadoBreaker;
      readonly contadorFalhas: number;
    },
  ) {
    this.occurredAt = new Date();
  }
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
      /** Prazo final para envio de propostas. null quando o edital não informa (RAD-303, A18 §5.1). */
      readonly prazoProposta: Date | null;
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
      /** Identidade real do anexo (RAD-291) — `nomeAnexo` é só display/auditoria. */
      readonly sequencialDocumento: number;
      readonly nomeAnexo: string;
      readonly storageKey: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado quando o scan AV aprova o anexo como limpo (P-104, AB14).
 * Consumido pela Triagem (P-110/RAD-281) para reenfileirar `triagem.solicitada` que ficou presa
 * em `processando` esperando o anexo sair da quarentena — fecha o loop de disponibilidade.
 */
export class AnexoAprovado implements DomainEvent {
  readonly type = 'anexo.aprovado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      /** Identidade real do anexo (RAD-291) — `nomeAnexo` é só display/auditoria. */
      readonly sequencialDocumento: number;
      readonly nomeAnexo: string;
      /** Outro anexo do MESMO edital ainda sem resultado de scan (P-110/RAD-281). */
      readonly restamPendentes: boolean;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado quando o scan AV detecta ameaça e isola o anexo (P-104, AB14).
 * Mesmo consumidor de `AnexoAprovado` (P-110/RAD-281): quando este é o ÚLTIMO anexo do edital a
 * resolver (`restamPendentes: false`) e nenhum ficou `limpo`, a Triagem sabe que o documento NUNCA
 * vai ficar disponível — falha terminal explícita em vez de `processando` para sempre.
 */
export class AnexoRejeitado implements DomainEvent {
  readonly type = 'anexo.rejeitado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      /** Identidade real do anexo (RAD-291) — `nomeAnexo` é só display/auditoria. */
      readonly sequencialDocumento: number;
      readonly nomeAnexo: string;
      /** Outro anexo do MESMO edital ainda sem resultado de scan (P-110/RAD-281). */
      readonly restamPendentes: boolean;
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
