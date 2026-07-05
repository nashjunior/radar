import type { AlertaId, TenantId } from '@radar/kernel';
import type { Canal } from '../value-objects/canal.js';

declare const __brand: unique symbol;
export type NotificacaoId = string & { readonly [__brand]: 'NotificacaoId' };
export const NotificacaoId = (raw: string): NotificacaoId => raw as NotificacaoId;

export type UsuarioId = string & { readonly [__brand]: 'UsuarioId' };
export const UsuarioId = (raw: string): UsuarioId => raw as UsuarioId;

export type StatusNotificacao = 'PENDENTE' | 'ENVIADA' | 'FALHOU';

export interface CriarNotificacaoParams {
  id: NotificacaoId;
  tenantId: TenantId;
  usuarioId: UsuarioId;
  alertaId: AlertaId;
  canal: Canal;
}

/**
 * Agregado raiz do bounded context Notificação (docs/13 §3).
 * Imutável: marcarEnviada/marcarFalhou retornam nova instância.
 * tenantId presente desde o dia 1 (A01 §6).
 */
export class Notificacao {
  private constructor(
    readonly id: NotificacaoId,
    readonly tenantId: TenantId,
    readonly usuarioId: UsuarioId,
    readonly alertaId: AlertaId,
    readonly canal: Canal,
    readonly status: StatusNotificacao,
    readonly criadaEm: Date,
    readonly enviadaEm: Date | undefined,
  ) {}

  static criar(params: CriarNotificacaoParams): Notificacao {
    return new Notificacao(
      params.id,
      params.tenantId,
      params.usuarioId,
      params.alertaId,
      params.canal,
      'PENDENTE',
      new Date(),
      undefined,
    );
  }

  marcarEnviada(): Notificacao {
    return new Notificacao(
      this.id, this.tenantId, this.usuarioId, this.alertaId,
      this.canal, 'ENVIADA', this.criadaEm, new Date(),
    );
  }

  marcarFalhou(): Notificacao {
    return new Notificacao(
      this.id, this.tenantId, this.usuarioId, this.alertaId,
      this.canal, 'FALHOU', this.criadaEm, this.enviadaEm,
    );
  }
}
