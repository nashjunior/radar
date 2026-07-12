import type { DbClient } from '@radar/kernel';
import type { CoberturaPrazoCriticoRepository } from '../../application/ports.js';

/**
 * Lê a projeção local `alerta_devido` (P-114, A18 §5.2) — nunca cruza schema de outro
 * contexto (o precedente `PostgresEditalMatchingView` foi revogado por P-97/RAD-95).
 * `coberto` exige as duas pernas locais que A18 §5.2 documenta: o `alerta` efetivamente
 * persistido (join intra-contexto por `alerta_id`, mesmo schema) e `notificado_em`
 * marcado pelo assinante local de `notificacao.enviada` (RAD-330).
 */
export class PostgresCoberturaPrazoCriticoRepository implements CoberturaPrazoCriticoRepository {
  constructor(private readonly db: DbClient) {}

  async contar(
    params: { agora: Date; diasLimiar: number },
    signal: AbortSignal,
  ): Promise<{ elegivel: number; coberto: number }> {
    const fimJanela = new Date(params.agora.getTime() + params.diasLimiar * 86_400_000);

    const { rows } = await this.db.query<{ elegivel: string; coberto: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE ad.prazo_proposta BETWEEN $1 AND $2) AS elegivel,
         COUNT(*) FILTER (
           WHERE ad.prazo_proposta BETWEEN $1 AND $2
             AND a.id IS NOT NULL
             AND ad.notificado_em IS NOT NULL
         ) AS coberto
       FROM alerta_devido ad
       LEFT JOIN alerta a ON a.id = ad.alerta_id`,
      [params.agora, fimJanela],
      { signal },
    );

    const row = rows[0];
    return {
      elegivel: Number(row?.elegivel ?? 0),
      coberto: Number(row?.coberto ?? 0),
    };
  }
}
