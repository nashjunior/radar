import type { DbClient, EditalId } from '@radar/kernel';
import type { ProvenienciaRepository } from '../../application/ports.js';

/**
 * Adaptador PostgreSQL para o repositório de proveniência.
 * Upsert idempotente: reingerir o mesmo edital atualiza coletado_em sem duplicar (A02, §3).
 * Gravação obrigatória em todo edital ingerido (docs/05, §5).
 */
export class PostgresProvenienciaRepository implements ProvenienciaRepository {
  constructor(private readonly db: DbClient) {}

  async registrar(
    params: {
      editalId: EditalId;
      fonte: string;
      baseLegal: string;
      coletadoEm: Date;
    },
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO proveniencias (edital_id, fonte, base_legal, coletado_em)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (edital_id) DO UPDATE SET
         fonte       = EXCLUDED.fonte,
         coletado_em = EXCLUDED.coletado_em`,
      [params.editalId, params.fonte, params.baseLegal, params.coletadoEm.toISOString()],
      { signal },
    );
  }
}
