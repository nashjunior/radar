/**
 * DB-tuning — autovacuum/TOAST/GIN por tabela quente + bootstrap de timeout por-role (P-41)
 *
 * Cobre o DoD de RAD-191: as migrações de tuning (arquitetura/05 §6, 06 §3, docs/11 §5) e o
 * script `infra/terraform/scripts/bootstrap-db-roles.sql` (mecanismo B do runbook) aplicados
 * e verificados sob Testcontainers — não só prosa/comentário de parameter group.
 *
 * Espelha:
 *   modules/ingestao/src/infra/migrations/003_autovacuum_edital.sql
 *   modules/matching/src/infra/migrations/004_autovacuum_alerta.sql
 *   modules/triagem/src/infra/migrations/002_extracao_edital_toast_gin.sql
 *   infra/terraform/scripts/bootstrap-db-roles.sql
 * (o mesmo tuning já está embutido em ./schema.sql, aplicado por todos os outros testes
 * db-stress — aqui é o único arquivo que verifica os storage parameters em si.)
 *
 * CAVEAT: requer Docker (Testcontainers).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startDb, teardownDb, type DbFixture } from './helpers/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BOOTSTRAP_ROLES_SQL = readFileSync(
  join(__dirname, '../../../infra/terraform/scripts/bootstrap-db-roles.sql'),
  'utf8',
);

let fx: DbFixture;

beforeAll(async () => {
  fx = await startDb(10); // schema.sql (com o tuning) já aplicado por startDb()
  await fx.pool.query(BOOTSTRAP_ROLES_SQL);
}, 120_000);

afterAll(async () => {
  await teardownDb(fx);
});

async function reloptionsDe(relname: string): Promise<string[]> {
  const { rows } = await fx.pool.query<{ reloptions: string[] | null }>(
    `SELECT reloptions FROM pg_class WHERE relname = $1`,
    [relname],
  );
  return rows[0]?.reloptions ?? [];
}

// ---------------------------------------------------------------------------
// Autovacuum agressivo + fillfactor — EDITAL (arquitetura/05 §6)
// ---------------------------------------------------------------------------

describe('Autovacuum + fillfactor — EDITAL (partições, P-41/RAD-191)', () => {
  it.each(['editais_2026_05', 'editais_2026_06', 'editais_2026_07', 'editais_default'])(
    '%s tem fillfactor=90 e scale_factor=0,02',
    async (particao) => {
      const opts = await reloptionsDe(particao);
      expect(opts).toContain('fillfactor=90');
      expect(opts).toContain('autovacuum_vacuum_scale_factor=0.02');
      expect(opts).toContain('autovacuum_analyze_scale_factor=0.02');
    },
  );
});

// ---------------------------------------------------------------------------
// Autovacuum agressivo — ALERTA (arquitetura/05 §6) — sem fillfactor (insert-only)
// ---------------------------------------------------------------------------

describe('Autovacuum — ALERTA (partições, P-41/RAD-191)', () => {
  it.each(['alerta_2026_05', 'alerta_2026_06', 'alerta_2026_07', 'alerta_default'])(
    '%s tem scale_factor=0,02 sem fillfactor',
    async (particao) => {
      const opts = await reloptionsDe(particao);
      expect(opts).toContain('autovacuum_vacuum_scale_factor=0.02');
      expect(opts).toContain('autovacuum_analyze_scale_factor=0.02');
      expect(opts.some((o) => o.startsWith('fillfactor'))).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// TOAST + GIN — EXTRACAO_EDITAL (arquitetura/05 §3, docs/11 §5)
// ---------------------------------------------------------------------------

describe('TOAST + GIN — EXTRACAO_EDITAL (P-41/RAD-191)', () => {
  it('toast_tuple_target=128 aplicado', async () => {
    const opts = await reloptionsDe('extracao_edital');
    expect(opts).toContain('toast_tuple_target=128');
  });

  it('índice GIN existe com fastupdate=on e gin_pending_list_limit=2048', async () => {
    const opts = await reloptionsDe('idx_extracao_edital_objeto_fts');
    expect(opts).toContain('fastupdate=on');
    expect(opts).toContain('gin_pending_list_limit=2048');
  });

  it('busca full-text do objeto usa o índice GIN e acha o edital certo', async () => {
    await fx.pool.query(
      `INSERT INTO extracao_edital
         (edital_id, objeto, valor_estimado, data_abertura_propostas, confianca, paginas)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)
       ON CONFLICT (edital_id) DO UPDATE SET objeto = EXCLUDED.objeto`,
      [
        'fts-edital-1',
        JSON.stringify({
          valor: 'Aquisição de equipamentos de informática para hospital regional',
          confianca: 0.9, citacao: null, critico: true,
        }),
        JSON.stringify({ valor: 100_000, confianca: 0.9, citacao: null, critico: true }),
        JSON.stringify({ valor: null, confianca: 0.5, citacao: null, critico: false }),
        0.9,
        5,
      ],
    );

    const { rows } = await fx.pool.query<{ edital_id: string }>(
      `SELECT edital_id FROM extracao_edital
        WHERE to_tsvector('portuguese', objeto ->> 'valor')
              @@ plainto_tsquery('portuguese', 'equipamentos hospital')`,
    );
    expect(rows.map((r) => r.edital_id)).toContain('fts-edital-1');

    const { rows: plano } = await fx.pool.query<Record<string, string>>(
      `EXPLAIN SELECT edital_id FROM extracao_edital
        WHERE to_tsvector('portuguese', objeto ->> 'valor')
              @@ plainto_tsquery('portuguese', 'equipamentos hospital')`,
    );
    const planoTexto = plano.map((linha) => Object.values(linha)[0]).join('\n');
    expect(planoTexto).toContain('idx_extracao_edital_objeto_fts');
  });
});

// ---------------------------------------------------------------------------
// Bootstrap de roles por-pool (P-41 mecanismo B) — infra/terraform/scripts/bootstrap-db-roles.sql
// ---------------------------------------------------------------------------

describe('Bootstrap de roles por-pool — timeouts (P-41 mecanismo B, RAD-191)', () => {
  it.each([
    ['ingestao', 'statement_timeout=30s', 'lock_timeout=3s'],
    ['matching', 'statement_timeout=10s', null],
    ['triagem', 'statement_timeout=5s', 'lock_timeout=3s'],
    ['analitico', 'statement_timeout=60s', null],
    ['jobs', 'statement_timeout=300s', null],
  ] as const)('role %s existe com os timeouts corretos no catálogo', async (role, stmt, lock) => {
    const { rows } = await fx.pool.query<{ rolconfig: string[] | null }>(
      `SELECT rolconfig FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(rows).toHaveLength(1);
    const cfg = rows[0]?.rolconfig ?? [];
    expect(cfg).toContain(stmt);
    if (lock) expect(cfg).toContain(lock);
  });

  it('roda 2× sem erro (idempotente)', async () => {
    await expect(fx.pool.query(BOOTSTRAP_ROLES_SQL)).resolves.toBeDefined();
  });

  // Prova que é ALTER ROLE (aplicado no connect) e não SET de sessão — a pegadinha do P-41
  // é que, em modo transação, um SET de sessão não sobreviveria entre transações.
  it('timeout é herdado no CONNECT — não é SET de sessão (pegadinha do modo transação)', async () => {
    await fx.pool.query(`ALTER ROLE jobs WITH PASSWORD 'rad191-teste'`);
    const client = new pg.Client({
      host: fx.container.getHost(),
      port: fx.container.getMappedPort(5432),
      database: fx.container.getDatabase(),
      user: 'jobs',
      password: 'rad191-teste',
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ setting: string }>(
        `SELECT current_setting('statement_timeout') AS setting`,
      );
      // Postgres normaliza a exibição de 300s para 5min — mesmo valor, herdado sem
      // nenhum SET explícito nesta conexão.
      expect(rows[0]?.setting).toBe('5min');
    } finally {
      await client.end();
    }
  });

  it('role bootstrapada opera nas tabelas quentes (identidade de conexão, não RLS de tenant)', async () => {
    await fx.pool.query(`ALTER ROLE ingestao WITH PASSWORD 'rad191-teste'`);
    const client = new pg.Client({
      host: fx.container.getHost(),
      port: fx.container.getMappedPort(5432),
      database: fx.container.getDatabase(),
      user: 'ingestao',
      password: 'rad191-teste',
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ count: string }>(`SELECT count(*)::text FROM editais`);
      expect(rows[0]).toBeDefined();
    } finally {
      await client.end();
    }
  });
});
