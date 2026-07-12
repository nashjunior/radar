import type { TenantId } from '@radar/kernel';
import type { DomainEvent } from '@radar/kernel';

export type { DomainEvent };

/**
 * Alerta interno de cota (RAD-247) — publicado pelo consumidor de `triagem.concluida`
 * quando `(usoReservado + usoConfirmado) / cota` cruza 80% ou 100% no ciclo vigente.
 * Pré-requisito do opt-in de excedente (P-107 (b), decidido por Produto); consumido
 * pela Notificação — Cobrança nunca decide canal/frequência (docs/13 §4).
 */
export class CotaAlertaAtingida implements DomainEvent {
  readonly type = 'assinatura.cota_alerta' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly percentual: 80 | 100;
      readonly usoAtual: number;
      readonly cota: number;
    },
  ) {
    this.occurredAt = new Date();
  }
}
