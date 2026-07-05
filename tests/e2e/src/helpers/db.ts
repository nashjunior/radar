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
 * Wrapper fino em cima de pg.Pool que satisfaz o DbClient usado nos adapters.
 * AbortSignal é best-effort nos testes — pg não suporta cancelamento por signal.
 */
export class PgDbClient {
  constructor(private readonly pool: pg.Pool) {}

  async query<R extends object>(
    sql: string,
    params: unknown[],
    _opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }> {
    const result = await this.pool.query<R>(sql, params as unknown[]);
    return { rows: result.rows };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export interface DbFixture {
  db: PgDbClient;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
}

/**
 * Inicia um container Postgres efêmero e aplica o schema.
 * Use em beforeAll; chame teardown() em afterAll.
 */
export async function startDb(): Promise<DbFixture> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const pool = new Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  });

  await pool.query(SCHEMA_SQL);

  return { db: new PgDbClient(pool), pool, container };
}

export async function teardownDb(fixture: DbFixture): Promise<void> {
  await fixture.pool.end();
  await fixture.container.stop();
}
