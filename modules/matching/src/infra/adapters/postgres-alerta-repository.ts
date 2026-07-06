import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import type { AlertaRepository } from '../../application/ports.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

export class PostgresAlertaRepository implements AlertaRepository {
  constructor(private readonly db: DbClient) {}

  async salvar(alerta: Alerta, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO alerta
         (id, tenant_id, cliente_final_id, criterio_id, edital_id, aderencia, relevante, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        alerta.id,
        alerta.tenantId,
        alerta.clienteFinalId,
        alerta.criterioId,
        alerta.editalId,
        alerta.aderencia.valor,
        alerta.relevante,
      ],
      { signal },
    );
  }

  async porId(id: AlertaId, signal: AbortSignal): Promise<Alerta | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM alerta WHERE id = $1`,
      [id],
      { signal },
    );
    return rows[0] ? rowToAlerta(rows[0]) : null;
  }

  async atualizarFeedback(
    id: AlertaId,
    relevante: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alerta SET relevante = $2 WHERE id = $1`,
      [id, relevante],
      { signal },
    );
  }
}

interface Row {
  id: string;
  tenant_id: string;
  cliente_final_id: string;
  criterio_id: string;
  edital_id: string;
  aderencia: number;
  relevante: boolean | null;
}

function rowToAlerta(row: Row): Alerta {
  return Alerta.reconstituir({
    id: AlertaId(row.id),
    tenantId: TenantId(row.tenant_id),
    clienteFinalId: ClienteFinalId(row.cliente_final_id),
    criterioId: CriterioId(row.criterio_id),
    editalId: EditalId(row.edital_id),
    aderencia: AderenciaMatching.criar(row.aderencia),
    relevante: row.relevante,
  });
}
