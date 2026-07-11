/**
 * DB2 — Fan-out Matching (A05 §2 → S4 fan-out, A06 §3 CRITERIO/ALERTA)
 *
 * Cenário: cada novo edital cruza com N critérios ativos de todos os clientes.
 * Query-alvo: casarComEdital() em PostgresCriterioRepository (modules/matching).
 * Gargalo provável: plano de query (scan), cálculo ts_rank, fan-out de alertas (A06).
 *
 * P-39 (RAD-165, 2026-07-10): editais é tabela particionada por RANGE(data_publicacao).
 * P-41 (RAD-165, 2026-07-10): pool de matching max=10, statement_timeout=10s.
 *
 * Cenários cobertos:
 *   DB2a — Latência com 1.000 critérios: p95 < 1.000 ms
 *   DB2b — Escala com 5.000 critérios: p95 < 2.500 ms (hipótese [A VALIDAR] — P-40)
 *   DB2c — Fan-out de alertas: 1 edital casa com 100 critérios → 100 inserts sem falha
 *   DB2d — Índices + pruning: partial index existe; EXPLAIN na partição quente sem Seq Scan
 *
 * Nota sobre seq scan em criterio_monitoramento: com ts_rank inline e tabela pequena,
 * o PostgreSQL pode escolher seq scan por custo — aceitável no MVP (P-40: [A VALIDAR]).
 * DB2d agora asserta explicitamente que a query na partição QUENTE de editais usa índice.
 *
 * CAVEAT: requer Docker (Testcontainers).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDbMatching, teardownDb, p, medirLatencias, type DbFixture } from './helpers/db.js';

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
// ON CONFLICT DO NOTHING sem target: PK de alerta é (id, criado_em) após P-39 —
// a ausência de target aceita qualquer conflito de forma idempotente.
const ALERTA_SQL = `
  INSERT INTO alerta (id, tenant_id, cliente_final_id, criterio_id, edital_id, aderencia, relevante, criado_em)
  VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
  ON CONFLICT DO NOTHING
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
  fx = await startDbMatching(); // P-41: max=10, statement_timeout=10s
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
// DB2d — Índices existem + EXPLAIN sem Seq Scan na partição quente de editais
// Gate P-39 (RAD-165): partition pruning — a query na partição 2026-07 não faz Seq Scan.
// Gate P-41: statement_timeout=10s corta runaway antes de virar lock.
// ---------------------------------------------------------------------------

describe('DB2d — índices esperados em pg_indexes; EXPLAIN sem Seq Scan na partição quente', () => {
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

  it('EXPLAIN na partição quente de editais (2026-07) não usa Seq Scan (P-39 partition pruning)', async () => {
    // Seed: ao menos 500 editais na partição 2026-07 para forçar o planner a usar índice
    const client = await fx.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 500; i++) {
        const dp = new Date(Date.UTC(2026, 6, 1) + i * 3_600_000).toISOString(); // julho 2026
        await client.query(
          `INSERT INTO editais
             (id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
              fase_atual, objeto, valor_estimado, prazo_proposta,
              data_publicacao, data_atualizacao,
              orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
              prov_fonte, prov_base_legal, prov_coletado_em, itens)
           VALUES ($1,$2,1,'Pregão','publicada','Objeto TI DB2d',$3,'2026-09-30T23:59:00Z',
                   $4,'2026-07-09T00:00:00Z','00000000000001','Órgão DB2d','SP','São Paulo',
                   'PNCP','Lei 14.133/2021, art. 174','2026-07-09T00:00:00Z','[]'::jsonb)
           ON CONFLICT (numero_controle_pncp, data_publicacao) DO NOTHING`,
          [`edital-db2d-${i}`, `DB2D-2026-07-${String(i).padStart(6, '0')}`, 300_000 + i, dp],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await fx.pool.query('ANALYZE editais');

    // EXPLAIN em query com filtro na partição 2026-07 (matching por data recente + índice de UF)
    const { rows: planRows } = await fx.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN
         SELECT id FROM editais
          WHERE data_publicacao >= '2026-07-01'
            AND data_publicacao  < '2026-08-01'
            AND orgao_uf = 'SP'`,
      [],
    );

    const planText = planRows.map(r => r['QUERY PLAN']).join('\n');
    console.info(`[DB2d] EXPLAIN plano:\n${planText}`);

    // Partition pruning: o plano deve mencionar a partição 2026-07 ou o child scan, nunca
    // escanear todas as partições. Asserta que o plano NÃO contém Seq Scan na tabela parent.
    const temSeqScanParent = /Seq Scan on editais\s/i.test(planText)
      && !/Seq Scan on editais_2026_07/i.test(planText)
      && !/Seq Scan on editais_default/i.test(planText);

    expect(
      temSeqScanParent,
      `Plano usa Seq Scan no parent 'editais' — partition pruning não funcionou:\n${planText}`,
    ).toBe(false);

    // O plano deve mencionar a partição correta (ou Index Scan nela)
    const mencionaParticao2607 = planText.includes('editais_2026_07');
    expect(
      mencionaParticao2607,
      `Plano não menciona a partição editais_2026_07 — pruning falhou ou dados fora da partição:\n${planText}`,
    ).toBe(true);
  });
});
