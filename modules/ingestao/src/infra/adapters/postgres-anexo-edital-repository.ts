import type { DbClient, EditalId } from '@radar/kernel';
import type { EstadoConfiancaAnexo } from '../../domain/value-objects/estado-confianca-anexo.js';
import type { AnexoEditalRepository, AnexoMetadados } from '../../application/ports.js';

interface Row {
  sequencial_documento: number;
  nome: string;
  storage_key: string;
  tipo_mime: string;
  tamanho_bytes: string;
  tipo_documento_id: number;
  tipo_documento_nome: string;
  texto_key: string;
  paginas: number;
  estado_confianca: EstadoConfiancaAnexo;
}

/**
 * Adaptador PostgreSQL para metadados de anexos materializados.
 * Inclui estado de confiança para trust-gating (P-104, AB14).
 * Upsert idempotente por (edital_id, sequencial_documento) — nunca por `nome`,
 * texto livre do órgão que pode se repetir entre documentos distintos (RAD-291).
 */
export class PostgresAnexoEditalRepository implements AnexoEditalRepository {
  constructor(private readonly db: DbClient) {}

  async listarPorEdital(editalId: EditalId, signal: AbortSignal): Promise<AnexoMetadados[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT sequencial_documento, nome, storage_key, tipo_mime, tamanho_bytes,
              tipo_documento_id, tipo_documento_nome, texto_key, paginas, estado_confianca
         FROM edital_anexos
        WHERE edital_id = $1
        ORDER BY sequencial_documento`,
      [editalId],
      { signal },
    );
    return rows.map((r) => ({
      sequencialDocumento: r.sequencial_documento,
      nome: r.nome,
      storageKey: r.storage_key,
      tipoMime: r.tipo_mime,
      tamanhoBytes: Number(r.tamanho_bytes),
      tipoDocumentoId: r.tipo_documento_id,
      tipoDocumentoNome: r.tipo_documento_nome,
      textoKey: r.texto_key,
      paginas: r.paginas,
      estadoConfianca: r.estado_confianca,
    }));
  }

  async salvar(editalId: EditalId, arquivos: AnexoMetadados[], signal: AbortSignal): Promise<void> {
    for (const arq of arquivos) {
      await this.db.query(
        `INSERT INTO edital_anexos
           (edital_id, sequencial_documento, nome, storage_key, tipo_mime, tamanho_bytes,
            tipo_documento_id, tipo_documento_nome, texto_key, paginas, estado_confianca)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (edital_id, sequencial_documento) DO UPDATE SET
           nome                = EXCLUDED.nome,
           storage_key         = EXCLUDED.storage_key,
           tipo_mime           = EXCLUDED.tipo_mime,
           tamanho_bytes       = EXCLUDED.tamanho_bytes,
           tipo_documento_id   = EXCLUDED.tipo_documento_id,
           tipo_documento_nome = EXCLUDED.tipo_documento_nome,
           texto_key           = EXCLUDED.texto_key,
           paginas             = EXCLUDED.paginas,
           estado_confianca    = EXCLUDED.estado_confianca`,
        [
          editalId,
          arq.sequencialDocumento,
          arq.nome,
          arq.storageKey,
          arq.tipoMime,
          arq.tamanhoBytes,
          arq.tipoDocumentoId,
          arq.tipoDocumentoNome,
          arq.textoKey,
          arq.paginas,
          arq.estadoConfianca,
        ],
        { signal },
      );
    }
  }

  async atualizarEstado(
    editalId: EditalId,
    sequencialDocumento: number,
    estado: EstadoConfiancaAnexo,
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `UPDATE edital_anexos
          SET estado_confianca = $3
        WHERE edital_id = $1
          AND sequencial_documento = $2`,
      [editalId, sequencialDocumento, estado],
      { signal },
    );
  }

  async atualizarTexto(
    editalId: EditalId,
    sequencialDocumento: number,
    textoKey: string,
    paginas: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `UPDATE edital_anexos
          SET texto_key = $3,
              paginas   = $4
        WHERE edital_id = $1
          AND sequencial_documento = $2`,
      [editalId, sequencialDocumento, textoKey, paginas],
      { signal },
    );
  }
}
