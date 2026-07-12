import { ClienteFinalId, TenantId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import { AtribuicaoPapel, UsuarioId } from '../../domain/atribuicao-papel.js';
import type { Papel } from '../../domain/papel.js';
import { UsuarioJaVinculadoError } from '../../domain/errors.js';
import type { PermissaoRepository } from '../../application/ports.js';

interface Row {
  sub: string;
  tenant_id: string;
  papel: string;
  cliente_final_ids: string[];
}

/**
 * Implementação Postgres de `PermissaoRepository` (P-52, RAD-285, docs/13 §3).
 * `criar` é um único `INSERT ... ON CONFLICT (sub) DO NOTHING` — a decisão de
 * unicidade (1 `sub` = 1 atribuição) é do banco; 0 linhas inseridas vira
 * `UsuarioJaVinculadoError`, o sinal que torna `ProvisionarOrganizacaoUseCase`
 * idempotente sob concorrência.
 */
export class PostgresPermissaoRepository implements PermissaoRepository {
  constructor(private readonly db: DbClient) {}

  async buscarPorUsuario(usuarioId: UsuarioId, opts: { signal: AbortSignal }): Promise<AtribuicaoPapel | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT sub, tenant_id, papel, cliente_final_ids FROM atribuicao_papel WHERE sub = $1`,
      [usuarioId],
      { signal: opts.signal },
    );
    const row = rows[0];
    return row ? rowParaAtribuicao(row) : null;
  }

  async criar(atribuicao: AtribuicaoPapel, signal: AbortSignal): Promise<void> {
    const { rows } = await this.db.query<{ ok: number }>(
      `INSERT INTO atribuicao_papel (sub, tenant_id, papel, cliente_final_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sub) DO NOTHING
       RETURNING 1 AS ok`,
      [atribuicao.usuarioId, atribuicao.tenantId, atribuicao.papel, atribuicao.clienteFinalIds],
      { signal },
    );
    if (rows.length === 0) throw new UsuarioJaVinculadoError();
  }
}

function rowParaAtribuicao(row: Row): AtribuicaoPapel {
  return AtribuicaoPapel.criar({
    usuarioId: UsuarioId(row.sub),
    tenantId: TenantId(row.tenant_id),
    papel: row.papel as Papel,
    clienteFinalIds: row.cliente_final_ids.map((id) => ClienteFinalId(id)),
  });
}
