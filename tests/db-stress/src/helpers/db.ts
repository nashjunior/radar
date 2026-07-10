import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_SQL = readFileSync(join(__dirname, '../../schema.sql'), 'utf8');

/**
 * Wrapper sobre pg.Pool compatível com o contrato DbClient dos adapters Postgres
 * (modules/*/src/infra/adapters). AbortSignal é best-effort; pg não cancela queries.
 */
export class PgDbClient {
  constructor(readonly pool: pg.Pool) {}

  async query<R extends object>(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: R[] }> {
    const result = await this.pool.query<R>(sql, params as unknown[]);
    return { rows: result.rows };
  }
}

export interface DbFixture {
  db: PgDbClient;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
}

/**
 * Inicia container Postgres efêmero (postgres:16-alpine), aplica schema.sql.
 * maxConnections: dimensiona o pool para simular pressão de conexões (DB3/DB5).
 */
export async function startDb(maxConnections = 20): Promise<DbFixture> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const pool = new Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    max: maxConnections,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  await pool.query(SCHEMA_SQL);

  return { db: new PgDbClient(pool), pool, container };
}

export async function teardownDb(fixture: DbFixture): Promise<void> {
  await fixture.pool.end();
  await fixture.container.stop();
}

/** Percentil p (0–100) de um array de durações em ms (não precisa estar ordenado). */
export function p(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

/** Executa fn N vezes sequencialmente; retorna array de latências em ms. */
export async function medirLatencias(
  fn: () => Promise<unknown>,
  n: number,
): Promise<number[]> {
  const lats: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    lats.push(performance.now() - t0);
  }
  return lats;
}

/** Executa fn N vezes em paralelo (Promise.all); retorna latências em ms. */
export async function medirLatenciasParalelo(
  fn: (i: number) => Promise<unknown>,
  n: number,
): Promise<number[]> {
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const elapsed = performance.now() - t0;
  // Não temos latências individuais em paralelo real — retornamos o wall-clock por slot
  return [elapsed / n];
}

/** Lê n_live_tup e n_dead_tup da tabela via pg_stat_user_tables (requer ANALYZE). */
export async function estatTabela(
  pool: pg.Pool,
  tabela: string,
): Promise<{ live: number; dead: number }> {
  const { rows } = await pool.query<{ n_live_tup: string; n_dead_tup: string }>(
    `SELECT n_live_tup::text, n_dead_tup::text
       FROM pg_stat_user_tables
      WHERE relname = $1`,
    [tabela],
  );
  const row = rows[0];
  return {
    live: Number(row?.n_live_tup ?? 0),
    dead: Number(row?.n_dead_tup ?? 0),
  };
}
