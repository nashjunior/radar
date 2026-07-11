import type { DbClient, EditalId } from '@radar/kernel';
import type { EstadoConfiancaAnexo } from '../../domain/value-objects/estado-confianca-anexo.js';
import type { AnexoEditalRepository, AnexoMetadados } from '../../application/ports.js';

interface Row {
  nome: string;
  storage_key: string;
  tipo_mime: string;
  tamanho_bytes: string;
  estado_confianca: EstadoConfiancaAnexo;
}

/**
 * Adaptador PostgreSQL para metadados de anexos materializados.
 * Inclui estado de confiança para trust-gating (P-104, AB14).
 * Upsert idempotente por (edital_id, nome) — reprocesso não duplica registro (A02, §3).
 */
export class PostgresAnexoEditalRepository implements AnexoEditalRepository {
  constructor(private readonly db: DbClient) {}

  async listarPorEdital(editalId: EditalId, signal: AbortSignal): Promise<AnexoMetadados[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT nome, storage_key, tipo_mime, tamanho_bytes, estado_confianca
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
      estadoConfianca: r.estado_confianca,
    }));
  }

  async salvar(editalId: EditalId, arquivos: AnexoMetadados[], signal: AbortSignal): Promise<void> {
    for (const arq of arquivos) {
      await this.db.query(
        `INSERT INTO edital_anexos
           (edital_id, nome, storage_key, tipo_mime, tamanho_bytes, estado_confianca)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (edital_id, nome) DO UPDATE SET
           storage_key      = EXCLUDED.storage_key,
           tipo_mime        = EXCLUDED.tipo_mime,
           tamanho_bytes    = EXCLUDED.tamanho_bytes,
           estado_confianca = EXCLUDED.estado_confianca`,
        [editalId, arq.nome, arq.storageKey, arq.tipoMime, arq.tamanhoBytes, arq.estadoConfianca],
        { signal },
      );
    }
  }

  async atualizarEstado(
    editalId: EditalId,
    nome: string,
    estado: EstadoConfiancaAnexo,
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `UPDATE edital_anexos
          SET estado_confianca = $3
        WHERE edital_id = $1
          AND nome = $2`,
      [editalId, nome, estado],
      { signal },
    );
  }
}
