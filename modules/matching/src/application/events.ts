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
      /** Publicação no PNCP — origem do relógio do SLO de frescor (docs/08 §4.1, A18 §5). */
      readonly editalPublicadoEm: Date;
      /** Aderência alta OU prazo crítico (P-81, A18 §5.1) — decidido no domínio do Matching. */
      readonly imediato: boolean;
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

/**
 * Publicado a cada ciclo do reconciliador de prazo crítico (RAD-303, A18 §5.1).
 * Cobre o SLO de error budget ZERO "0 alertas de prazo crítico perdidos" (docs/08 §4.1) —
 * `perdido` é um NÃO-evento (alerta que deveria existir e não existe), por isso não há
 * contador de incremento equivalente: este evento É a métrica. `perdido >= 1` é o
 * gatilho de severidade máxima (RCA + replay, P-35/P-36).
 */
export class AlertaPrazoCriticoReconciliado implements DomainEvent {
  readonly type = 'alerta.prazo-critico.reconciliado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly elegivel: number;
      readonly coberto: number;
      readonly perdido: number;
    },
  ) {
    this.occurredAt = new Date();
  }
}
