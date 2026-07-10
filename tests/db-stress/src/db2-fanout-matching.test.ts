/**
 * DB2 — Fan-out Matching (A05 §2 → S4 fan-out, A06 §3 CRITERIO/ALERTA)
 *
 * Cenário: cada novo edital cruza com N critérios ativos de todos os clientes.
 * Query-alvo: casarComEdital() em PostgresCriterioRepository (modules/matching).
 * Gargalo provável: plano de query (scan), cálculo ts_rank, fan-out de alertas (A06).
 *
 * Cenários cobertos:
 *   DB2a — Latência com 1.000 critérios: p95 < 1.000 ms
 *   DB2b — Escala com 5.000 critérios: p95 < 2.500 ms (hipótese [A VALIDAR] — P-40)
 *   DB2c — Fan-out de alertas: 1 edital casa com 100 critérios → 100 inserts sem falha
 *   DB2d — Isolamento de índices: partial index (ativo=true) está catalogado em pg_indexes
 *
 * Nota sobre seq scan (A05 §3): com ts_rank inline e tabela pequena, o PostgreSQL
 * pode escolher seq scan por custo — aceitável no MVP (P-40: [A VALIDAR] percolator).
 * O gate é a latência, não o plano. Versão para escala revisitará via P-40.
 *
 * CAVEAT: requer Docker (Testcontainers). Alvos numéricos finos — P-39/P-41.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDb, teardownDb, p, medirLatencias, type DbFixture } from './helpers/db.js';

// ---------------------------------------------------------------------------
// Query idêntica à do PostgresCriterioRepository.casarComEdital()
// ---------------------------------------------------------------------------
const FAN_OUT_SQL = `
  SELECT c.id, c.tenant_id, c.cliente_final_id,
         CASE
           WHEN c.palavras_chave IS NOT NULL AND array_length(c.palavras_chave, 1) > 0
           THEN ts_rank(
             to_tsvector('portuguese', $1),
             plainto_tsquery('portuguese', array_to_string(c.palavras_chave, ' '))
           )
           ELSE 0.5
         END AS score
    FROM criterio_monitoramento c
   WHERE c.ativo = true
     AND (c.ramo_cnae IS NULL OR c.ramo_cnae = $2)
     AND (c.regiao_uf IS NULL OR c.regiao_uf = $3)
     AND (c.faixa_valor_min IS NULL OR $4::numeric >= c.faixa_valor_min)
     AND (c.faixa_valor_max IS NULL OR $4::numeric <= c.faixa_valor_max)
   ORDER BY score DESC
`;

// Insert de alerta (fan-out output) — idêntico ao PostgresAlertaRepository.salvar()
const ALERTA_SQL = `
  INSERT INTO alerta (id, tenant_id, cliente_final_id, criterio_id, edital_id, aderencia, relevante, criado_em)
  VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
  ON CONFLICT (id) DO NOTHING
`;

// ---------------------------------------------------------------------------
// Geração de fixtures sintéticas
// ---------------------------------------------------------------------------

function gerarCriterio(i: number, tenant = `tenant-${i % 10}`) {
  return {
    id: `criterio-${i}`,
    tenant_id: tenant,
    cliente_final_id: `cliente-${i % 100}`,
    ramo_cnae: i % 3 === 0 ? null : `${60 + (i % 10)}.${i % 5}0`,  // ~2/3 com CNAE
    regiao_uf: i % 4 === 0 ? null : ['SP', 'RJ', 'MG', 'RS'][i % 4],  // ~3/4 com UF
    faixa_valor_min: i % 2 === 0 ? null : 10_000,
    faixa_valor_max: i % 2 === 0 ? null : 5_000_000,
    palavras_chave: i % 5 === 0 ? [] : ['software', 'TI', 'sistemas', 'tecnologia'].slice(0, (i % 4) + 1),
    ativo: true,
  };
}

async function seedCriterios(fx: DbFixture, n: number): Promise<void> {
  const client = await fx.pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < n; i++) {
      const c = gerarCriterio(i);
      await client.query(
        `INSERT INTO criterio_monitoramento
           (id, tenant_id, cliente_final_id, ramo_cnae, regiao_uf,
            faixa_valor_min, faixa_valor_max, palavras_chave, ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.tenant_id, c.cliente_final_id, c.ramo_cnae, c.regiao_uf,
         c.faixa_valor_min, c.faixa_valor_max, c.palavras_chave, c.ativo],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Edital representativo: TI, SP, ~R$ 300k
const EDITAL_TI = {
  objetoDescricao: 'Contratação de serviços de desenvolvimento de software e infraestrutura de TI',
  uf: 'SP',
  cnae: '62.01',
  valorEstimado: 300_000,
};

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let fx: DbFixture;

beforeAll(async () => {
  fx = await startDb();
}, 120_000);

afterAll(async () => {
  await teardownDb(fx);
});

// ---------------------------------------------------------------------------
// DB2a — Latência com 1.000 critérios: p95 < 1.000 ms
// ---------------------------------------------------------------------------

describe('DB2a — latência do fan-out com 1.000 critérios', () => {
  it('p95 da query casarComEdital < 1.000 ms com 1.000 critérios ativos', async () => {
    await fx.pool.query('TRUNCATE criterio_monitoramento, alerta');
    await seedCriterios(fx, 1_000);
    await fx.pool.query('ANALYZE criterio_monitoramento');

    const lats = await medirLatencias(async () => {
      await fx.pool.query(FAN_OUT_SQL, [
        EDITAL_TI.objetoDescricao, EDITAL_TI.cnae, EDITAL_TI.uf, EDITAL_TI.valorEstimado,
      ]);
    }, 20);

    const p50 = p(lats, 50);
    const p95 = p(lats, 95);

    console.info(
      `[DB2a] 1.000 critérios — p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );

    expect(p95, `p95 excede 1.000 ms (gargalo de matching — revisar índices/P-40)`).toBeLessThan(1_000);
  });
});

// ---------------------------------------------------------------------------
// DB2b — Escala com 5.000 critérios: p95 < 2.500 ms [A VALIDAR] P-40
// ---------------------------------------------------------------------------

describe('DB2b — latência do fan-out com 5.000 critérios (escala)', () => {
  it('p95 < 2.500 ms com 5.000 critérios ativos [A VALIDAR — P-40 percolator]', async () => {
    await fx.pool.query('TRUNCATE criterio_monitoramento, alerta');
    await seedCriterios(fx, 5_000);
    await fx.pool.query('ANALYZE criterio_monitoramento');

    const lats = await medirLatencias(async () => {
      await fx.pool.query(FAN_OUT_SQL, [
        EDITAL_TI.objetoDescricao, EDITAL_TI.cnae, EDITAL_TI.uf, EDITAL_TI.valorEstimado,
      ]);
    }, 10);

    const p50 = p(lats, 50);
    const p95 = p(lats, 95);

    console.info(
      `[DB2b] 5.000 critérios — p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`,
    );

    expect(p95, `p95 excede 2.500 ms com 5.000 critérios — P-40 (percolator) deve ser considerado`).toBeLessThan(2_500);
  });
});

// ---------------------------------------------------------------------------
// DB2c — Fan-out de alertas: 1 edital × 100 critérios casados → 100 inserts
// ---------------------------------------------------------------------------

describe('DB2c — fan-out de alertas: write amplification', () => {
  it('insere 100 alertas (1 por critério casado) sem falha; count correto no DB', async () => {
    await fx.pool.query('TRUNCATE criterio_monitoramento, alerta');

    // Seed: 100 critérios sem filtros (casam com qualquer edital)
    const client = await fx.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 100; i++) {
        await client.query(
          `INSERT INTO criterio_monitoramento
             (id, tenant_id, cliente_final_id, ramo_cnae, regiao_uf,
              faixa_valor_min, faixa_valor_max, palavras_chave, ativo)
           VALUES ($1,$2,$3,NULL,NULL,NULL,NULL,$4,true)`,
          [`criterio-fanout-${i}`, 'tenant-fanout', `cliente-${i}`, ['software', 'TI']],
        );
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Simula o casamento: obtém os critérios e insere um alerta por resultado
    const { rows } = await fx.pool.query<{ id: string; tenant_id: string; cliente_final_id: string }>(
      FAN_OUT_SQL,
      ['Contratação de TI e software', null, null, 300_000],
    );

    const t0 = performance.now();
    await Promise.all(
      rows.map((r, idx) =>
        fx.pool.query(ALERTA_SQL, [
          `alerta-fanout-${idx}`,
          r.tenant_id,
          r.cliente_final_id,
          r.id,
          'edital-fanout-001',
          0.75,
          null,
        ]),
      ),
    );
    const elapsedMs = performance.now() - t0;

    console.info(
      `[DB2c] ${rows.length} critérios casados → ${rows.length} alertas em ${elapsedMs.toFixed(1)}ms`,
    );

    const { rows: countRows } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM alerta WHERE edital_id = 'edital-fanout-001'`,
      [],
    );
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(Number(countRows[0]!.count)).toBe(rows.length);
  });
});

// ---------------------------------------------------------------------------
// DB2d — Índices existem (garantia estrutural de design)
// ---------------------------------------------------------------------------

describe('DB2d — índices esperados estão catalogados em pg_indexes', () => {
  it('partial index (ativo=true) e índice de tenant existem em criterio_monitoramento', async () => {
    const { rows } = await fx.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'criterio_monitoramento'
        ORDER BY indexname`,
      [],
    );
    const nomes = rows.map(r => r.indexname);

    expect(nomes).toContain('idx_criterio_ativo');
    expect(nomes).toContain('idx_criterio_tenant');

    const { rows: alertaIdx } = await fx.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'alerta' ORDER BY indexname`,
      [],
    );
    const alertaNomes = alertaIdx.map(r => r.indexname);
    expect(alertaNomes).toContain('idx_alerta_tenant');
    expect(alertaNomes).toContain('idx_alerta_edital');
  });
});
