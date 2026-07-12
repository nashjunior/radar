import type { DbClient } from '@radar/kernel';
import type { WebhookEventoRepository } from '../../application/ports.js';

/**
 * Implementação Postgres do dedupe anti-replay do webhook (P-107 (5), RAD-250).
 * Um único `INSERT ... ON CONFLICT DO NOTHING` — a decisão sob concorrência (duas
 * entregas do mesmo evento chegando quase simultâneas) é do banco, nunca deste
 * adapter, mesmo padrão de `PostgresAssinaturaRepository.reservarCota`.
 */
export class PostgresWebhookEventoRepository implements WebhookEventoRepository {
  constructor(private readonly db: DbClient) {}

  async registrarSePrimeiraVez(provedor: string, eventoExternoId: string, signal: AbortSignal): Promise<boolean> {
    const { rows } = await this.db.query<{ ok: number }>(
      `INSERT INTO webhook_evento_processado (provedor, evento_externo_id)
       VALUES ($1, $2)
       ON CONFLICT (provedor, evento_externo_id) DO NOTHING
       RETURNING 1 AS ok`,
      [provedor, eventoExternoId],
      { signal },
    );
    return rows.length > 0;
  }

  /** Compensação do claim (RAD-250) — desfaz para que a reentrega do provedor reprocesse do zero. */
  async desfazerRegistro(provedor: string, eventoExternoId: string, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `DELETE FROM webhook_evento_processado WHERE provedor = $1 AND evento_externo_id = $2`,
      [provedor, eventoExternoId],
      { signal },
    );
  }
}
