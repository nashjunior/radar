/**
 * Contrato mínimo de cliente de banco de dados usado pelos adapters Postgres de infra (A10 §7).
 * Puramente estrutural — sem vocabulário de domínio —, tech-agnóstico apesar do driver
 * concreto ser Postgres hoje; cada módulo injeta sua própria implementação no composition root.
 */
export interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}
