import { TenantId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import { Tenant } from '../../domain/tenant.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { OrganizacaoJaExisteError } from '../../domain/errors.js';
import type { TenantRepository } from '../../application/ports.js';

interface Row {
  id: string;
  cnpj: string;
  razao_social: string;
}

/**
 * Implementação Postgres de `TenantRepository` (RAD-285, docs/13 §3). `salvar`
 * é um único `INSERT ... ON CONFLICT (cnpj) DO NOTHING` — a decisão de unicidade
 * (1 CNPJ = 1 tenant, P-109 L3) é do banco, nunca deste adapter (mesmo padrão de
 * `PostgresWebhookEventoRepository`); 0 linhas inseridas vira `OrganizacaoJaExisteError`.
 */
export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly db: DbClient) {}

  async porId(tenantId: TenantId, signal: AbortSignal): Promise<Tenant | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT id, cnpj, razao_social FROM tenant WHERE id = $1`,
      [tenantId],
      { signal },
    );
    const row = rows[0];
    return row ? rowParaTenant(row) : null;
  }

  async porCnpj(cnpj: Cnpj, signal: AbortSignal): Promise<Tenant | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT id, cnpj, razao_social FROM tenant WHERE cnpj = $1`,
      [cnpj.valor],
      { signal },
    );
    const row = rows[0];
    return row ? rowParaTenant(row) : null;
  }

  async salvar(tenant: Tenant, signal: AbortSignal): Promise<void> {
    const { rows } = await this.db.query<{ ok: number }>(
      `INSERT INTO tenant (id, cnpj, razao_social)
       VALUES ($1, $2, $3)
       ON CONFLICT (cnpj) DO NOTHING
       RETURNING 1 AS ok`,
      [tenant.id, tenant.cnpj.valor, tenant.razaoSocial],
      { signal },
    );
    if (rows.length === 0) throw new OrganizacaoJaExisteError();
  }
}

function rowParaTenant(row: Row): Tenant {
  return Tenant.criar({
    id: TenantId(row.id),
    cnpj: Cnpj.criar(row.cnpj),
    razaoSocial: row.razao_social,
  });
}
