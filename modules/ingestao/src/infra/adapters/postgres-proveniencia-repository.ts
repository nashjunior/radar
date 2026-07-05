import type { EditalId } from '@radar/kernel';
import type { ProvenienciaRepository } from '../../application/ports.js';

/**
 * Adaptador PostgreSQL para o repositório de proveniência.
 * Gravação obrigatória em todo edital ingerido (docs/05, §5).
 *
 * TODO: implementar com driver pg ou knex após o schema físico ser definido (A03, §4).
 */
export class PostgresProvenienciaRepository implements ProvenienciaRepository {
  // constructor(private readonly db: Pool) {}  // TODO: injetar pool pg

  async registrar(
    _params: {
      editalId: EditalId;
      fonte: string;
      baseLegal: string;
      coletadoEm: Date;
    },
    _signal: AbortSignal,
  ): Promise<void> {
    // TODO:
    // INSERT INTO proveniencias (edital_id, fonte, base_legal, coletado_em)
    // VALUES ($1, $2, $3, $4)
    // ON CONFLICT (edital_id) DO UPDATE SET
    //   fonte = EXCLUDED.fonte, coletado_em = EXCLUDED.coletado_em
    throw new Error('PostgresProvenienciaRepository.registrar: não implementado');
  }
}
