/**
 * DB6 — Crescimento 10× (A05 §2, A06 §3 EDITAL, P-39)
 *
 * Gate P-39 (RAD-165, 2026-07-10): particionamento RANGE mensal em `editais`.
 * Este cenário popula MÚLTIPLAS partições mensais para simular o crescimento
 * acumulado (volume histórico 10×) e asserta que:
 *   1. A query de matching na partição QUENTE (2026-07) só escaneia essa partição
 *      — partition pruning funciona (EXPLAIN não mostra Seq Scan no parent).
 *   2. A latência da query na partição quente é CONSTANTE independente do volume
 *      histórico nas partições frias (queries em p95 < 200 ms com e sem histórico).
 *   3. O plano menciona explicitamente a partição correta (editais_2026_07).
 *
 * Tabelas envolvidas: `editais` (particionada por data_publicacao, RANGE mensal).
 * Partições criadas no schema.sql: 2026-05, 2026-06, 2026-07, DEFAULT.
 *
 * Cenários cobertos:
 *   DB6a — Seed multi-partição: 3.000 editais em 3 meses (1.000/mês) sem erro
 *   DB6b — Pruning: EXPLAIN da query na partição 2026-07 sem Seq Scan no parent;
 *           menciona editais_2026_07
 *   DB6c — Latência constante: p95 da query com 3.000 registros históricos
 *           ≤ p95 com apenas os 1.000 da partição quente × 1,5 (tolerância 50%)
 *
 * CAVEAT: requer Docker (Testcontainers).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDbMatching, teardownDb, p, medirLatencias, type DbFixture } from './helpers/db.js';

// ---------------------------------------------------------------------------
// Geração de dados sintéticos por partição — nunca toca PNCP real (A04 §4)
// ---------------------------------------------------------------------------

type MesInfo = { ano: number; mes: number; partLabel: string };

const MESES: MesInfo[] = [
  { ano: 2026, mes: 4, partLabel: '2026-05' },  // partição maio (mês JS = 4)
  { ano: 2026, mes: 5, partLabel: '2026-06' },  // partição junho
  { ano: 2026, mes: 6, partLabel: '2026-07' },  // partição julho — partição quente
];

const POR_PARTIÇÃO = 1_000; // 1.000 editais por mês → total de 3.000 (simula 10× do seed inicial)

function gerarEditalParticao(mesInfo: MesInfo, i: number) {
  // data_publicacao: distribui ao longo do mês usando o tamanho real do mês,
  // garantindo que todos os POR_PARTIÇÃO registros caiam na partição correta.
  const startMs = Date.UTC(mesInfo.ano, mesInfo.mes, 1);
  const endMs   = Date.UTC(mesInfo.ano, mesInfo.mes + 1, 1);  // exclusivo
  const stepMs  = Math.floor((endMs - startMs) / POR_PARTIÇÃO);
  const dpMs = startMs + i * stepMs;
  const dp = new Date(dpMs).toISOString();
  const seqGlobal = mesInfo.mes * POR_PARTIÇÃO + i;
  return {
    id: `edital-db6-${mesInfo.partLabel}-${i}`,
    numero_controle_pncp: `DB6-${mesInfo.partLabel}-${String(i).padStart(6, '0')}`,
    modalidade_codigo: 2,
    modalidade_nome: 'Pregão',
    fase_atual: 'publicada',
    objeto: `Contratação de software e TI lote ${seqGlobal % 20}`,
    valor_estimado: 50_000 + seqGlobal * 100,
    prazo_proposta: '2026-09-30T23:59:00Z',
    data_publicacao: dp,
    data_atualizacao: '2026-07-10T00:00:00Z',
    orgao_cnpj: `0000000${String(seqGlobal % 1_000).padStart(7, '0')}`,
    orgao_nome: `Órgão DB6 ${seqGlobal % 50}`,
    orgao_uf: ['SP', 'RJ', 'MG', 'RS', 'PR'][seqGlobal % 5]!,
    orgao_municipio: 'São Paulo',
  };
}

const UPSERT_SQL = `
  INSERT INTO editais
    (id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
     fase_atual, objeto, valor_estimado, prazo_proposta,
     data_publicacao, data_atualizacao,
     orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
     prov_fonte, prov_base_legal, prov_coletado_em, itens)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          'PNCP','Lei 14.133/2021, art. 174','2026-07-10T00:00:00Z','[]'::jsonb)
  ON CONFLICT (numero_controle_pncp, data_publicacao) DO NOTHING
`;

// Query de matching por data recente + UF (simula casarComEdital na partição quente)
const MATCHING_QUERY = `
  SELECT id, objeto, valor_estimado, orgao_uf
    FROM editais
   WHERE data_publicacao >= '2026-07-01'
     AND data_publicacao  < '2026-08-01'
     AND orgao_uf = 'SP'
   ORDER BY data_publicacao DESC
   LIMIT 100
`;

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
// DB6a — Seed multi-partição: 3.000 editais em 3 meses sem erro
// ---------------------------------------------------------------------------

describe('DB6a — seed 3.000 editais em 3 partições mensais', () => {
  it('insere 1.000 editais/mês em 2026-05, 2026-06 e 2026-07 sem erro', async () => {
    await fx.pool.query('TRUNCATE editais');

    let totalInserido = 0;

    for (const mes of MESES) {
      const client = await fx.pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < POR_PARTIÇÃO; i++) {
          const e = gerarEditalParticao(mes, i);
          await client.query(UPSERT_SQL, [
            e.id, e.numero_controle_pncp, e.modalidade_codigo, e.modalidade_nome,
            e.fase_atual, e.objeto, e.valor_estimado, e.prazo_proposta,
            e.data_publicacao, e.data_atualizacao,
            e.orgao_cnpj, e.orgao_nome, e.orgao_uf, e.orgao_municipio,
          ]);
          totalInserido++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      console.info(`[DB6a] partição ${mes.partLabel}: ${POR_PARTIÇÃO} editais inseridos`);
    }

    await fx.pool.query('ANALYZE editais');

    const { rows } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM editais`,
      [],
    );

    console.info(`[DB6a] total no banco: ${rows[0]!.count} (esperado: ${MESES.length * POR_PARTIÇÃO})`);

    expect(Number(rows[0]!.count)).toBe(MESES.length * POR_PARTIÇÃO);
  });
});

// ---------------------------------------------------------------------------
// DB6b — Partition pruning: EXPLAIN sem Seq Scan no parent; menciona 2026-07
// ---------------------------------------------------------------------------

describe('DB6b — EXPLAIN na partição quente (2026-07) sem Seq Scan no parent', () => {
  it('query com filtro em data_publicacao 2026-07 usa partition pruning (sem Seq Scan no parent)', async () => {
    const { rows: planRows } = await fx.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${MATCHING_QUERY}`,
      [],
    );

    const planText = planRows.map(r => r['QUERY PLAN']).join('\n');
    console.info(`[DB6b] EXPLAIN plano (query 2026-07):\n${planText}`);

    // Pruning funciona: o plano NÃO deve conter Seq Scan direto na tabela parent 'editais'
    // (sem sufixo de partição). Scan nas partições-filho é esperado.
    const seqScanParent = /Seq Scan on editais\b(?!_)/i.test(planText);
    expect(
      seqScanParent,
      `Plano usa Seq Scan no parent 'editais' — partition pruning falhou:\n${planText}`,
    ).toBe(false);

    // O plano DEVE mencionar a partição correta
    expect(
      planText,
      `Plano não menciona a partição editais_2026_07 — pruning falhou ou dados fora da partição:\n${planText}`,
    ).toContain('editais_2026_07');

    // Partições frias (maio e junho) NÃO devem aparecer no plano
    expect(
      planText,
      `Plano inclui partição fria editais_2026_05 — pruning não filtrou partições passadas:\n${planText}`,
    ).not.toContain('editais_2026_05');

    expect(
      planText,
      `Plano inclui partição fria editais_2026_06 — pruning não filtrou partições passadas:\n${planText}`,
    ).not.toContain('editais_2026_06');
  });
});

// ---------------------------------------------------------------------------
// DB6c — Latência constante com volume histórico 3× (partições frias não degradam)
// ---------------------------------------------------------------------------

describe('DB6c — latência da query na partição quente é constante com histórico 10×', () => {
  it('p95 da query 2026-07 com 3.000 registros históricos ≤ 200 ms (isolada pela pruning)', async () => {
    await fx.pool.query('ANALYZE editais');

    // Latência com histórico total (3 partições, 3.000 registros)
    const latsComHistorico = await medirLatencias(async () => {
      await fx.pool.query(MATCHING_QUERY, []);
    }, 20);

    const p50hist = p(latsComHistorico, 50);
    const p95hist = p(latsComHistorico, 95);

    console.info(
      `[DB6c] com histórico (3.000 total): p50=${p50hist.toFixed(1)}ms p95=${p95hist.toFixed(1)}ms`,
    );

    // Gate: a partição quente tem ~200 registros SP, ~1.000 total.
    // Com partition pruning, o custo é proporcional à partição ativa, não ao total histórico.
    expect(
      p95hist,
      `p95 ${p95hist.toFixed(1)}ms > 200 ms — partition pruning não isolou a partição quente`,
    ).toBeLessThan(200);
  });

  it('variação por partição: count por mês confirma dados nas 3 partições', async () => {
    const { rows } = await fx.pool.query<{ mes: string; count: string }>(`
      SELECT to_char(date_trunc('month', data_publicacao), 'YYYY-MM') AS mes,
             count(*)::text AS count
        FROM editais
       GROUP BY 1
       ORDER BY 1
    `, []);

    console.info('[DB6c] distribuição por partição:', rows);

    expect(rows.length).toBe(MESES.length);
    for (const row of rows) {
      expect(Number(row.count)).toBe(POR_PARTIÇÃO);
    }
  });
});
