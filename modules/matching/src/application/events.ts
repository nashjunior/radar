import type { AlertaId, ClienteFinalId, CriterioId, DomainEvent, EditalId, TenantId } from '@radar/kernel';

export type { DomainEvent };

/**
 * Publicado após geração de alerta para um critério ativo.
 * Consumidor: Notificação (A03 §3 — Cliente-Fornecedor).
 */
export class AlertaGerado implements DomainEvent {
  readonly type = 'alerta.gerado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly alertaId: AlertaId;
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly criterioId: CriterioId;
      readonly editalId: EditalId;
      readonly aderencia: number;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado quando o usuário registra feedback em um alerta.
 * Consumidor: Matching (ajuste de pesos futuro — docs/11 §5).
 */
export class FeedbackAlerta implements DomainEvent {
  readonly type = 'feedback.alerta' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly alertaId: AlertaId;
      readonly relevante: boolean;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado quando o usuário abre/visualiza um alerta.
 * Alimenta o funil de ativação (docs/08 §3, P-15).
 */
export class AlertaAberto implements DomainEvent {
  readonly type = 'alerta.aberto' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly alertaId: AlertaId;
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Publicado após definição de um novo critério de monitoramento.
 */
export class CriterioDefinido implements DomainEvent {
  readonly type = 'criterio.definido' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly criterioId: CriterioId;
      readonly clienteFinalId: ClienteFinalId;
    },
  ) {
    this.occurredAt = new Date();
  }
}
