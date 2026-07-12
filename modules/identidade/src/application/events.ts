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

/**
 * Published Language (RAD-285, docs/14 §6): emitido após provisionar uma
 * organização nova. Payload mínimo — `sub` como `string` primitiva (nunca o
 * branded `UsuarioId` do módulo) para não vazar o tipo interno de Identidade &
 * Organização a quem consome (Cobrança inicia o trial, arquitetura/03 §3).
 */
export class OrganizacaoProvisionada implements DomainEvent {
  readonly type = 'organizacao.provisionada' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly sub: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}
