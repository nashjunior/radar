import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_SQL = readFileSync(join(__dirname, '../schema.sql'), 'utf8');

/**
 * Wrapper sobre pg.Pool compatível com o contrato DbClient dos adapters Postgres
 * (modules/{módulo}/src/infra/adapters). AbortSignal é best-effort; pg não cancela queries.
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

// ---------------------------------------------------------------------------
// GUCs por workload (P-41, arq/05 §6, RAD-165, 2026-07-10)
// Espelhados do pooler em modo transação de produção — SET por conexão.
// ---------------------------------------------------------------------------

type WorkloadGUCs = {
  statement_timeout: string;
  lock_timeout?: string;
  idle_in_transaction_session_timeout?: string;
  work_mem?: string;
};

const GUCS: Record<string, WorkloadGUCs> = {
  ingestao: {
    statement_timeout: '30000',           // 30 s — rajada S1; lotes sob lock
    lock_timeout: '3000',                 // 3 s — falha rápido, re-tenta idempotente
    idle_in_transaction_session_timeout: '30000',  // 30 s — mata transação vazada
    work_mem: '16MB',
  },
  matching: {
    statement_timeout: '10000',           // 10 s — corta seq scan runaway (DB2)
    work_mem: '16MB',
  },
  triagem: {
    statement_timeout: '5000',            // 5 s — sub-segundo em prod, folga p/ testes
    lock_timeout: '3000',
    idle_in_transaction_session_timeout: '30000',
    work_mem: '16MB',
  },
  analitico: {
    statement_timeout: '60000',           // 60 s — range scans DB4
    work_mem: '128MB',                    // SET LOCAL work_mem='128MB' p/ analítico
  },
  jobs: {
    statement_timeout: '300000',          // 300 s — DETACH/index build
    work_mem: '16MB',
  },
};

/**
 * Aplica GUCs como padrão permanente do banco de teste via `ALTER DATABASE SET`.
 * Mais fiável que pool.on('connect') (fire-and-forget async + race no pg@8) e
 * que `options` (não respeitado pelo pg Pool). Todo novo `pool.connect()` herda
 * automaticamente, sem SET explícito por conexão.
 */
async function applyGucsToBanco(
  client: { query(sql: string, params?: unknown[]): Promise<unknown> },
  dbName: string,
  gucs: WorkloadGUCs,
): Promise<void> {
  const stmts = [
    `ALTER DATABASE "${dbName}" SET statement_timeout = '${gucs.statement_timeout}'`,
    gucs.lock_timeout
      ? `ALTER DATABASE "${dbName}" SET lock_timeout = '${gucs.lock_timeout}'`
      : null,
    gucs.idle_in_transaction_session_timeout
      ? `ALTER DATABASE "${dbName}" SET idle_in_transaction_session_timeout = '${gucs.idle_in_transaction_session_timeout}'`
      : null,
    gucs.work_mem
      ? `ALTER DATABASE "${dbName}" SET work_mem = '${gucs.work_mem}'`
      : null,
  ].filter(Boolean) as string[];

  for (const stmt of stmts) {
    await client.query(stmt);
  }
}

// ---------------------------------------------------------------------------
// Fábrica interna — cria container + pool + schema
// ---------------------------------------------------------------------------

async function criarFixture(max: number, gucs?: WorkloadGUCs): Promise<DbFixture> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const connBase = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  };

  // 1. Setup: schema + GUCs via ALTER DATABASE usando client dedicado (antes do pool).
  //    ALTER DATABASE SET persiste em pg_db_role_setting; toda nova conexão ao banco herda.
  const setupClient = new pg.Client(connBase);
  await setupClient.connect();
  await setupClient.query(SCHEMA_SQL);
  if (gucs) await applyGucsToBanco(setupClient, container.getDatabase(), gucs);
  await setupClient.end();

  // 2. Pool de trabalho — conexões herdam os GUCs definidos acima sem SET explícito.
  const pool = new Pool({
    ...connBase,
    max,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  return { db: new PgDbClient(pool), pool, container };
}

// ---------------------------------------------------------------------------
// API pública — uma função por bulkhead (P-41)
// ---------------------------------------------------------------------------

/** Pool de ingestão: max 15, statement_timeout 30 s, lock_timeout 3 s. */
export async function startDbIngestao(): Promise<DbFixture> {
  return criarFixture(15, GUCS.ingestao);
}

/** Pool de matching: max 10, statement_timeout 10 s. */
export async function startDbMatching(): Promise<DbFixture> {
  return criarFixture(10, GUCS.matching);
}

/** Pool de triagem/API: max 10, statement_timeout 5 s, lock_timeout 3 s. */
export async function startDbTriagem(): Promise<DbFixture> {
  return criarFixture(10, GUCS.triagem);
}

/** Pool analítico/reconciliação: max 5, statement_timeout 60 s, work_mem 128 MB. */
export async function startDbAnalitico(): Promise<DbFixture> {
  return criarFixture(5, GUCS.analitico);
}

/** Pool de jobs/retenção/partição: max 5, statement_timeout 300 s. */
export async function startDbJobs(): Promise<DbFixture> {
  return criarFixture(5, GUCS.jobs);
}

/**
 * Pool genérico sem GUCs de workload — mantido para cenários que não pertencem
 * a um único bulkhead (ex.: DB5 soak misto) ou testes de infra isolados.
 * Aplica idle_in_transaction_session_timeout=30s como GUC de segurança mínima.
 */
export async function startDb(maxConnections = 20): Promise<DbFixture> {
  return criarFixture(maxConnections, {
    statement_timeout: '60000',
    idle_in_transaction_session_timeout: '30000',
    work_mem: '16MB',
  });
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
