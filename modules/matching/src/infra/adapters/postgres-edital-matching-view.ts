import { EditalId } from '@radar/kernel';
import type { EditalMatchingView } from '../../application/ports.js';
import type { EditalParaMatchingDTO } from '../../application/dtos.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

interface Row {
  id: string;
  modalidade_codigo: number;
  objeto: string;
  orgao_uf: string;
  valor_estimado: string | null;
  data_publicacao: Date;
}

/**
 * Leitura somente-leitura do Catálogo (tabela `editais` da Ingestão) para o Matching.
 * O Matching nunca escreve no Catálogo — isolamento entre bounded contexts (docs/13 §4).
 * CNAE não está disponível na tabela de editais do MVP — projetado como null.
 */
export class PostgresEditalMatchingView implements EditalMatchingView {
  constructor(private readonly db: DbClient) {}

  async porId(id: EditalId, signal: AbortSignal): Promise<EditalParaMatchingDTO | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT id, modalidade_codigo, objeto, orgao_uf, valor_estimado, data_publicacao
         FROM editais
        WHERE id = $1`,
      [id],
      { signal },
    );
    return rows[0] ? rowToDTO(rows[0]) : null;
  }
}

function rowToDTO(row: Row): EditalParaMatchingDTO {
  return {
    id: EditalId(row.id),
    tenantScope: 'global',
    modalidadeCodigo: Number(row.modalidade_codigo),
    objetoDescricao: row.objeto,
    uf: row.orgao_uf || null,
    cnae: null,
    valorEstimado: row.valor_estimado != null ? Number(row.valor_estimado) : null,
    dataPublicacao: new Date(row.data_publicacao),
  };
}
