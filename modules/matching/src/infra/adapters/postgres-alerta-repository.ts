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

  async salvarEmLote(alertas: Alerta[], signal: AbortSignal): Promise<void> {
    if (alertas.length === 0) return;
    // Constrói uma única INSERT multi-row: ON CONFLICT (id) DO NOTHING — idempotente (P-41).
    // 7 colunas por linha → parâmetros $1..$7, $8..$14, etc.
    const COLUNAS = 7;
    const values: unknown[] = [];
    const placeholders = alertas.map((a, i) => {
      const base = i * COLUNAS;
      values.push(
        a.id,
        a.tenantId,
        a.clienteFinalId,
        a.criterioId,
        a.editalId,
        a.aderencia.valor,
        a.relevante,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},NOW())`;
    });

    await this.db.query(
      `INSERT INTO alerta
         (id, tenant_id, cliente_final_id, criterio_id, edital_id, aderencia, relevante, criado_em)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO NOTHING`,
      values,
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

  async listarPorTenant(tenantId: TenantId, signal: AbortSignal): Promise<Alerta[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM alerta WHERE tenant_id = $1 ORDER BY criado_em DESC`,
      [tenantId],
      { signal },
    );
    return rows.map(rowToAlerta);
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
