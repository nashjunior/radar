import type { AlertaId } from '@radar/kernel';
import type { Notificacao } from '../../domain/entities/notificacao.js';
import type { UsuarioId } from '../../domain/entities/notificacao.js';
import type { NotificacaoRepository } from '../../application/ports.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

/** Upsert idempotente por id — reprocessamento de mensagem da fila é seguro. */
export class PostgresNotificacaoRepository implements NotificacaoRepository {
  constructor(private readonly db: DbClient) {}

  async salvar(notificacao: Notificacao, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO notificacao
         (id, tenant_id, usuario_id, alerta_id, canal, status, criada_em, enviada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status     = EXCLUDED.status,
         enviada_em = EXCLUDED.enviada_em`,
      [
        notificacao.id,
        notificacao.tenantId,
        notificacao.usuarioId,
        notificacao.alertaId,
        notificacao.canal.tipo,
        notificacao.status,
        notificacao.criadaEm,
        notificacao.enviadaEm ?? null,
      ],
      { signal },
    );
  }

  async jaNotificado(
    alertaId: AlertaId,
    usuarioId: UsuarioId,
    signal: AbortSignal,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM notificacao
         WHERE alerta_id = $1 AND usuario_id = $2 AND status = 'ENVIADA'
       ) AS exists`,
      [alertaId, usuarioId],
      { signal },
    );
    return rows[0]?.exists ?? false;
  }
}
