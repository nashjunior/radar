/**
 * `DbClient` de produção sobre `pg` (A10 §7) — a peça que faltava para `criarMatchingComposicao`
 * (`modules/matching/src/infra/composicao.ts`) entrar em `apps/api` com dependências reais
 * (RAD-319 item 5; RAD-317: "não inventar dublê de produção" — sem variante stub). Mesmo padrão
 * de `PgDbClient`/`criarPool` em `tools/pipeline-local/src/infra.ts` (dublê de DEV), aqui como
 * código de produção do composition root.
 */
import pg from 'pg';
import type { DbClient } from '@radar/kernel';

export class PgDbClient implements DbClient {
  constructor(private readonly pool: pg.Pool) {}

  async query<R extends object>(
    sql: string,
    params: unknown[],
    _opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }> {
    const result = await this.pool.query<R>(sql, params);
    return { rows: result.rows };
  }

  /** Fecha o pool — chamado pelo `teardown()` do composition root (shutdown gracioso, SIGTERM). */
  async encerrar(): Promise<void> {
    await this.pool.end();
  }
}

export function criarPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}
