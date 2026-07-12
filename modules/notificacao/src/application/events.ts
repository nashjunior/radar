import type { AlertaId, DomainEvent, TenantId } from '@radar/kernel';
import type { NotificacaoId, UsuarioId } from '../domain/entities/notificacao.js';

export type { DomainEvent };

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
      /**
       * `occurredAt` do `alerta.gerado` que originou este envio — origem do SLO de entrega
       * imediata (docs/08 §4.1, A18 §5). Só disponível no caminho imediato (o digest é
       * scheduler-driven, sem o instante do alerta individual sem reintroduzir leitura
       * cross-contexto — débito já registrado em RAD-91).
       */
      readonly alertaGeradoEm?: Date;
    },
  ) {
    this.occurredAt = new Date();
  }
}
