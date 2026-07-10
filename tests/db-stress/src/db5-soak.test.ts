/**
 * DB5 — Soak (A05 §2 → S5, A06 §3)
 *
 * Cenário: carga contínua por horas → detectar degradação cumulativa.
 * Um soak real dura horas; este teste simula a dinâmica em miniatura (300 rounds)
 * para detectar os padrões documentados em A05/A06:
 *   - Bloat de dead tuples (autovacuum não aciona durante o teste curto — rastreamos)
 *   - Vazamento de conexões (pool.totalCount / pool.idleCount ao final)
 *   - Degradação de latência ao longo do tempo (p95 início vs. fim)
 *
 * Cenários cobertos:
 *   DB5a — Carga mista: 300 rounds de upsert + lookup sem erro ao longo do tempo
 *   DB5b — Sem vazamento de conexão: pool.idleCount == pool.totalCount ao final
 *   DB5c — Dead tuples rastreados: n_dead_tup / n_live_tup ao final (informativo)
 *   DB5d — Sem degradação severa: p95 dos últimos 50 rounds ≤ 3× p95 dos primeiros 50
 *
 * CAVEAT: requer Docker (Testcontainers). Um soak completo (horas) depende de
 * ambiente de CI dedicado — RAD-130. Esta suíte valida que nenhum padrão de
 * degradação emerge mesmo em escala curta. Alvos de autovacuum — P-41.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  startDb, teardownDb, p, estatTabela, type DbFixture,
} from './helpers/db.js';

// ---------------------------------------------------------------------------
// Queries (upsert + lookup cobrem editais, extracao_edital e triagem)
// ---------------------------------------------------------------------------

const EDITAL_UPSERT = `
  INSERT INTO editais
    (id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
     fase_atual, objeto, valor_estimado, prazo_proposta,
     data_publicacao, data_atualizacao,
     orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
     prov_fonte, prov_base_legal, prov_coletado_em, itens)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
  ON CONFLICT (numero_controle_pncp) DO UPDATE SET
    fase_atual       = EXCLUDED.fase_atual,
    objeto           = EXCLUDED.objeto,
    valor_estimado   = EXCLUDED.valor_estimado,
    data_atualizacao = EXCLUDED.data_atualizacao,
    prov_coletado_em = EXCLUDED.prov_coletado_em
`;

const EXTRACAO_UPSERT = `
  INSERT INTO extracao_edital
    (edital_id, objeto, valor_estimado, data_abertura_propostas,
     requisitos, riscos_brutos, confianca, paginas)
  VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
  ON CONFLICT (edital_id) DO UPDATE SET
    confianca = EXCLUDED.confianca,
    paginas   = EXCLUDED.paginas
`;

const TRIAGEM_UPSERT = `
  INSERT INTO triagem
    (tenant_id, cliente_final_id, edital_id, perfil_id, status, aderencia, recomendacao, riscos)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
  ON CONFLICT (tenant_id, edital_id, perfil_id) DO UPDATE SET
    aderencia    = EXCLUDED.aderencia,
    recomendacao = EXCLUDED.recomendacao
`;

const EDITAL_SELECT = `SELECT id FROM editais WHERE id = $1`;
const EXTRACAO_SELECT = `SELECT edital_id FROM extracao_edital WHERE edital_id = $1`;

// ---------------------------------------------------------------------------
// Fixtures sintéticas
// ---------------------------------------------------------------------------

function campoJson(valor: unknown, confianca = 0.9) {
  return JSON.stringify({ valor, confianca, citacao: null, critico: true });
}

function editalParams(i: number): unknown[] {
  return [
    `soak-edital-${i % 100}`,
    `2026-SOAK-${String(i % 100).padStart(6, '0')}`,
    1, 'Pregão', 'publicada',
    `Objeto soak round ${i}`, 100_000 + i,
    '2026-09-30T23:59:00Z',
    '2026-07-01T00:00:00Z', '2026-07-09T00:00:00Z',
    '00000000000001', 'Órgão Soak', 'SP', 'São Paulo',
    'PNCP', 'Lei 14.133/2021, art. 174', '2026-07-09T00:00:00Z',
    '[]',
  ];
}

function extracaoParams(i: number): unknown[] {
  return [
    `soak-edital-${i % 100}`,
    campoJson('Objeto soak'),
    campoJson(100_000 + i),
    campoJson('2026-09-15T09:00:00Z'),
    JSON.stringify([]),
    JSON.stringify([]),
    0.9,
    10,
  ];
}

function triagemParams(i: number): unknown[] {
  return [
    `tenant-soak-${i % 3}`,
    `cliente-soak-${i % 5}`,
    `soak-edital-${i % 100}`,
    `perfil-soak-${i % 4}`,
    'concluida',
    0.5 + (i % 50) / 100,
    'ANALISAR',
    JSON.stringify([]),
  ];
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let fx: DbFixture;

beforeAll(async () => {
  fx = await startDb(15); // pool moderado para detectar starvation
}, 120_000);

afterAll(async () => {
  await teardownDb(fx);
});

// ---------------------------------------------------------------------------
// DB5a + DB5b + DB5c + DB5d — Soak com 300 rounds de carga mista
// ---------------------------------------------------------------------------

describe('DB5 — Soak: 300 rounds de carga mista (upsert + lookup)', () => {
  it(
    'completa 300 rounds sem erro; pool não vaza conexões; latência não degrada > 3×',
    async () => {
      await fx.pool.query(`
        TRUNCATE editais, criterio_monitoramento, alerta, extracao_edital, triagem
      `);

      const ROUNDS = 300;
      const latencias: number[] = [];
      let erros = 0;

      for (let round = 0; round < ROUNDS; round++) {
        const t0 = performance.now();

        try {
          // Upsert do edital
          await fx.pool.query(EDITAL_UPSERT, editalParams(round));

          // Upsert da extração (cache)
          await fx.pool.query(EXTRACAO_UPSERT, extracaoParams(round));

          // Upsert de triagem
          await fx.pool.query(TRIAGEM_UPSERT, triagemParams(round));

          // Leitura (simula matching + triagem lendo em paralelo com escrita)
          await Promise.all([
            fx.pool.query(EDITAL_SELECT, [`soak-edital-${round % 100}`]),
            fx.pool.query(EXTRACAO_SELECT, [`soak-edital-${round % 100}`]),
          ]);
        } catch (err) {
          erros++;
          console.warn(`[DB5] round ${round} falhou: ${String(err)}`);
        }

        latencias.push(performance.now() - t0);

        // A cada 100 rounds: log de progresso + stats do pool
        if ((round + 1) % 100 === 0) {
          const slice = latencias.slice(-100);
          console.info(
            `[DB5] round ${round + 1}/${ROUNDS} — ` +
            `p50=${p(slice, 50).toFixed(1)}ms p95=${p(slice, 95).toFixed(1)}ms ` +
            `pool.total=${fx.pool.totalCount} pool.idle=${fx.pool.idleCount} ` +
            `erros=${erros}`,
          );
        }
      }

      // ---------------------------------------------------------------------------
      // DB5a — Sem erros
      // ---------------------------------------------------------------------------
      expect(erros, `${erros} rounds falharam — instabilidade sob carga contínua`).toBe(0);

      // ---------------------------------------------------------------------------
      // DB5b — Sem vazamento de conexão
      // ---------------------------------------------------------------------------
      // Aguarda um tick para que conexões pendentes retornem ao pool
      await new Promise(r => setTimeout(r, 50));
      const poolTotal = fx.pool.totalCount;
      const poolIdle = fx.pool.idleCount;
      console.info(`[DB5b] pool ao final: total=${poolTotal} idle=${poolIdle}`);
      expect(
        poolIdle,
        `conexões vazando: idle=${poolIdle} < total=${poolTotal} — pool starved`,
      ).toBe(poolTotal);

      // ---------------------------------------------------------------------------
      // DB5c — Dead tuples (informativo; autovacuum não aciona em teste curto)
      // ---------------------------------------------------------------------------
      const statsEdital = await estatTabela(fx.pool, 'editais');
      const statsTriagem = await estatTabela(fx.pool, 'triagem');
      console.info(
        `[DB5c] editais: live=${statsEdital.live} dead=${statsEdital.dead}; ` +
        `triagem: live=${statsTriagem.live} dead=${statsTriagem.dead}`,
      );

      // ---------------------------------------------------------------------------
      // DB5d — Sem degradação severa de latência (últimos 50 rounds vs. primeiros 50)
      // ---------------------------------------------------------------------------
      const inicio = latencias.slice(0, 50);
      const fim = latencias.slice(-50);
      const p95inicio = p(inicio, 95);
      const p95fim = p(fim, 95);

      console.info(
        `[DB5d] latência p95: início=${p95inicio.toFixed(1)}ms fim=${p95fim.toFixed(1)}ms ` +
        `(ratio=${p95inicio > 0 ? (p95fim / p95inicio).toFixed(2) : 'n/a'}×)`,
      );

      if (p95inicio > 0) {
        expect(
          p95fim,
          `degradação severa: p95 final (${p95fim.toFixed(1)}ms) > 3× p95 inicial (${p95inicio.toFixed(1)}ms)`,
        ).toBeLessThanOrEqual(p95inicio * 3);
      }
    },
    300_000,
  );
});
