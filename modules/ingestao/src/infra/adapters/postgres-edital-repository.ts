import type { EditalId } from '@radar/kernel';
import type { EditalRepository } from '../../application/ports.js';
import type { Edital } from '../../domain/entities/edital.js';

/**
 * Adaptador PostgreSQL para o repositório de editais.
 * Upsert por `numero_controle_pncp` (UNIQUE) garante idempotência (A02, §3).
 *
 * TODO: implementar com driver pg ou knex após o schema físico ser definido (A03, §4).
 * TODO: listarPorJanelaPublicacao deve usar cursor/keyset pagination para grandes volumes.
 */
export class PostgresEditalRepository implements EditalRepository {
  // constructor(private readonly db: Pool) {}  // TODO: injetar pool pg

  async upsertPorNumeroControle(
    _edital: Edital,
    _signal: AbortSignal,
  ): Promise<void> {
    // TODO:
    // INSERT INTO editais (id, numero_controle_pncp, modalidade_codigo, ...)
    // VALUES ($1, $2, $3, ...)
    // ON CONFLICT (numero_controle_pncp)
    // DO UPDATE SET fase_atual = EXCLUDED.fase_atual,
    //               data_atualizacao = EXCLUDED.data_atualizacao, ...
    throw new Error('PostgresEditalRepository.upsertPorNumeroControle: não implementado');
  }

  async porId(_id: EditalId, _signal: AbortSignal): Promise<Edital | null> {
    // TODO: SELECT * FROM editais WHERE id = $1
    throw new Error('PostgresEditalRepository.porId: não implementado');
  }

  async porNumeroControle(
    _numeroPncp: string,
    _signal: AbortSignal,
  ): Promise<Edital | null> {
    // TODO: SELECT * FROM editais WHERE numero_controle_pncp = $1
    throw new Error('PostgresEditalRepository.porNumeroControle: não implementado');
  }

  async *listarPorJanelaPublicacao(
    _janela: { inicio: Date; fim: Date },
    _signal: AbortSignal,
  ): AsyncGenerator<Edital[]> {
    // TODO: SELECT com cursor keyset (id > $cursor ORDER BY data_publicacao, id)
    //       WHERE data_publicacao BETWEEN $inicio AND $fim
    //       LIMIT $pagina_size
    throw new Error('PostgresEditalRepository.listarPorJanelaPublicacao: não implementado');
  }
}
