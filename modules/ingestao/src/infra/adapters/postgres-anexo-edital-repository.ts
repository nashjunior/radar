import type { EditalId } from '@radar/kernel';
import type { ArquivoDTO } from '../../application/dtos.js';
import type { AnexoEditalRepository } from '../../application/ports.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

interface Row {
  nome: string;
  storage_key: string;
  tipo_mime: string;
  tamanho_bytes: string;
}

/**
 * Adaptador PostgreSQL para metadados de anexos materializados.
 * Upsert idempotente por (edital_id, nome) — reprocesso não duplica registro (A02, §3).
 */
export class PostgresAnexoEditalRepository implements AnexoEditalRepository {
  constructor(private readonly db: DbClient) {}

  async listarPorEdital(editalId: EditalId, signal: AbortSignal): Promise<ArquivoDTO[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT nome, storage_key, tipo_mime, tamanho_bytes
         FROM edital_anexos
        WHERE edital_id = $1
        ORDER BY nome`,
      [editalId],
      { signal },
    );
    return rows.map((r) => ({
      nome: r.nome,
      storageKey: r.storage_key,
      tipoMime: r.tipo_mime,
      tamanhoBytes: Number(r.tamanho_bytes),
    }));
  }

  async salvar(editalId: EditalId, arquivos: ArquivoDTO[], signal: AbortSignal): Promise<void> {
    for (const arq of arquivos) {
      await this.db.query(
        `INSERT INTO edital_anexos (edital_id, nome, storage_key, tipo_mime, tamanho_bytes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (edital_id, nome) DO UPDATE SET
           storage_key   = EXCLUDED.storage_key,
           tipo_mime     = EXCLUDED.tipo_mime,
           tamanho_bytes = EXCLUDED.tamanho_bytes`,
        [editalId, arq.nome, arq.storageKey, arq.tipoMime, arq.tamanhoBytes],
        { signal },
      );
    }
  }
}
