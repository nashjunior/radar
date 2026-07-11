import type { FaixaValorReferencia } from '../../application/ports.js';
import type { FaixaValorDTO } from '../../application/dtos.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

interface Row {
  codigo: string;
  min: string | null;
  max: string | null;
  vigente_de: Date;
  vigente_ate: Date | null;
}

/**
 * Faixas de valor lidas de tabela parametrizável e datada (docs/02 §2; docs/04 §4).
 * Nunca enum ou constante no código — as faixas são configuração de negócio.
 */
export class PostgresFaixaValorReferencia implements FaixaValorReferencia {
  constructor(private readonly db: DbClient) {}

  async faixasVigentes(data: Date, signal: AbortSignal): Promise<FaixaValorDTO[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT codigo, min, max, vigente_de, vigente_ate
         FROM faixa_valor_referencia
        WHERE vigente_de <= $1
          AND (vigente_ate IS NULL OR vigente_ate > $1)
        ORDER BY COALESCE(min, 0)`,
      [data.toISOString()],
      { signal },
    );
    return rows.map(rowToDTO);
  }
}

function rowToDTO(row: Row): FaixaValorDTO {
  return {
    codigo: row.codigo,
    min: row.min != null ? Number(row.min) : null,
    max: row.max != null ? Number(row.max) : null,
    vigenteDe: new Date(row.vigente_de),
    vigenteAte: row.vigente_ate ? new Date(row.vigente_ate) : null,
  };
}
