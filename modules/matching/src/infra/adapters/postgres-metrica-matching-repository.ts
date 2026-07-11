import type { TenantId } from '@radar/kernel';
import type { MetricaMatchingRepository } from '../../application/ports.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

/**
 * Lê métricas de qualidade do matching a partir da tabela `alerta` (P-14, P-15, docs/08 §3).
 * Somente leitura — nunca muta estado. Gate P-21: nenhum peso de matching é alterado aqui.
 */
export class PostgresMetricaMatchingRepository implements MetricaMatchingRepository {
  constructor(private readonly db: DbClient) {}

  async precisao(
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<{ relevantes: number; comFeedback: number }> {
    const { rows } = await this.db.query<{ relevantes: string; com_feedback: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE relevante = true)         AS relevantes,
         COUNT(*) FILTER (WHERE relevante IS NOT NULL)    AS com_feedback
       FROM alerta
       WHERE tenant_id = $1`,
      [tenantId],
      { signal },
    );
    const row = rows[0];
    return {
      relevantes: Number(row?.relevantes ?? 0),
      comFeedback: Number(row?.com_feedback ?? 0),
    };
  }

  async ativacao(
    tenantId: TenantId,
    janelaEmDias: number,
    signal: AbortSignal,
  ): Promise<{ ativados: number; total: number }> {
    /**
     * Ativação (docs/08 §3): clientes com ≥1 alerta relevante dentro da janela
     * sobre o total de clientes com ≥1 alerta gerado na mesma janela.
     * Requer coluna `criado_em` na tabela `alerta` (migração 002).
     */
    const { rows } = await this.db.query<{ total: string; ativados: string }>(
      `WITH na_janela AS (
         SELECT cliente_final_id
         FROM alerta
         WHERE tenant_id = $1
           AND criado_em >= NOW() - ($2::int * INTERVAL '1 day')
         GROUP BY cliente_final_id
       ),
       ativados AS (
         SELECT cliente_final_id
         FROM alerta
         WHERE tenant_id = $1
           AND relevante = true
           AND criado_em >= NOW() - ($2::int * INTERVAL '1 day')
         GROUP BY cliente_final_id
       )
       SELECT
         (SELECT COUNT(*) FROM na_janela)  AS total,
         (SELECT COUNT(*) FROM ativados)   AS ativados`,
      [tenantId, janelaEmDias],
      { signal },
    );
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      ativados: Number(row?.ativados ?? 0),
    };
  }
}
