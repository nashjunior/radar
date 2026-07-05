import type { AlertaId, TenantId } from '@radar/kernel';
import type { NotificacaoId, UsuarioId } from '../domain/entities/notificacao.js';

export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

/**
 * Publicado após envio bem-sucedido de uma notificação.
 * Consumidor: Governança & Conformidade (auditoria — A03 §3).
 */
export class NotificacaoEnviada implements DomainEvent {
  readonly type = 'notificacao.enviada' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly notificacaoId: NotificacaoId;
      readonly tenantId: TenantId;
      readonly usuarioId: UsuarioId;
      readonly alertaId: AlertaId;
      readonly canal: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}
