import type { ClienteFinalId, DomainEvent, PerfilId, TenantId } from '@radar/kernel';

export type { DomainEvent };

/** Published Language (docs/14 §6): emitido após criar/atualizar Perfil de Habilitação. */
export class PerfilAtualizado implements DomainEvent {
  readonly type = 'perfil.atualizado' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly perfilId: PerfilId;
    },
  ) {
    this.occurredAt = new Date();
  }
}
