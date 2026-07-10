/**
 * DB1 — Upsert em Rajada (A05 §2 → S1 burst, A06 §3 EDITAL)
 *
 * Cenário: ingestão do PNCP em janela de publicação (burst).
 * Volume-alvo (docs/12 §3, P-31): ~5.900 editais/dia útil + ~15.000 atualizações.
 *   Burst hipotético: ~600 editais em 5 min = 2/s.
 * Gate: o upsert NÃO pode ser o gargalo do frescor ≤ 30 min (docs/07 §6).
 *
 * Cenários cobertos:
 *   DB1a — Throughput: 500 upserts em < 30 s (= 16,7/s; 8× acima do burst-alvo)
 *   DB1b — Idempotência: ON CONFLICT não altera count; campo atualizado conforme
 *   DB1c — Concorrência: 20 writers paralelos (10 editais cada) sem deadlock
 *
 * CAVEAT: requer Docker (Testcontainers). Execution pendente enquanto Docker
 * não estiver disponível — RAD-130. Alvos numéricos finos dependem de P-39/P-41.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDb, teardownDb, type DbFixture } from './helpers/db.js';

// ---------------------------------------------------------------------------
// Geração de dados sintéticos — nunca toca PNCP real (A04 §4)
// ---------------------------------------------------------------------------

const UFS = ['SP', 'RJ', 'MG', 'RS', 'PR'] as const;
const MODALIDADES: Array<[number, string]> = [
  [1, 'Licitação'], [2, 'Pregão'], [3, 'Concorrência'],
  [4, 'Concurso'], [6, 'Credenciamento'],
];

function gerarEdital(i: number) {
  const uf = UFS[i % UFS.length]!;
  const [cod, nome] = MODALIDADES[i % MODALIDADES.length]!;
  return {
    id: `edital-${i}`,
    numero_controle_pncp: `2026-01-00001-${String(i).padStart(7, '0')}`,
    modalidade_codigo: cod,
    modalidade_nome: nome,
    fase_atual: i % 5 === 0 ? 'encerrada' : 'publicada',
    objeto: `Aquisição de equipamentos de TI — lote ${i % 20}`,
    valor_estimado: 50_000 + i * 500,
    prazo_proposta: '2026-09-30T23:59:00Z',
    data_publicacao: new Date(Date.UTC(2026, 5, 1) - i * 3_600_000).toISOString(),
    data_atualizacao: '2026-07-09T00:00:00Z',
    orgao_cnpj: `0000000${String(i % 1000).padStart(7, '0')}`,
    orgao_nome: `Órgão Teste ${i % 30}`,
    orgao_uf: uf,
    orgao_municipio: 'São Paulo',
    prov_fonte: 'PNCP',
    prov_base_legal: 'Lei 14.133/2021, art. 174',
    prov_coletado_em: '2026-07-09T00:00:00Z',
    itens: '[]',
  };
}

// Query de upsert idêntica à do PostgresEditalRepository (modules/ingestao)
const UPSERT_SQL = `
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
    prazo_proposta   = EXCLUDED.prazo_proposta,
    data_atualizacao = EXCLUDED.data_atualizacao,
    prov_coletado_em = EXCLUDED.prov_coletado_em,
    itens            = EXCLUDED.itens
`;

function upsertParams(e: ReturnType<typeof gerarEdital>): unknown[] {
  return [
    e.id, e.numero_controle_pncp, e.modalidade_codigo, e.modalidade_nome,
    e.fase_atual, e.objeto, e.valor_estimado, e.prazo_proposta,
    e.data_publicacao, e.data_atualizacao,
    e.orgao_cnpj, e.orgao_nome, e.orgao_uf, e.orgao_municipio,
    e.prov_fonte, e.prov_base_legal, e.prov_coletado_em, e.itens,
  ];
}

// ---------------------------------------------------------------------------
// Fixture — 1 container compartilhado por suite
// ---------------------------------------------------------------------------

let fx: DbFixture;

beforeAll(async () => {
  fx = await startDb();
}, 120_000);

afterAll(async () => {
  await teardownDb(fx);
});

// ---------------------------------------------------------------------------
// DB1a — Throughput: 500 upserts em < 30 s
// ---------------------------------------------------------------------------

describe('DB1a — throughput de upsert em rajada', () => {
  it('insere 500 editais em < 30 s (gate: ≥ 16,7 linhas/s = 8× o burst-alvo de 2/s)', async () => {
    await fx.pool.query('TRUNCATE editais');

    const N = 500;
    const editais = Array.from({ length: N }, (_, i) => gerarEdital(i));

    const t0 = performance.now();
    for (const e of editais) {
      await fx.pool.query(UPSERT_SQL, upsertParams(e));
    }
    const elapsedS = (performance.now() - t0) / 1_000;
    const throughput = N / elapsedS;

    console.info(
      `[DB1a] ${N} upserts em ${elapsedS.toFixed(2)}s = ${throughput.toFixed(1)} linhas/s`,
    );

    const { rows } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM editais`,
      [],
    );
    expect(Number(rows[0]!.count)).toBe(N);
    expect(
      elapsedS,
      `throughput insuficiente: ${throughput.toFixed(1)}/s — gargalo pode afetar frescor ≤ 30 min`,
    ).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// DB1b — Idempotência: ON CONFLICT não duplica linhas; atualiza campos
// ---------------------------------------------------------------------------

describe('DB1b — idempotência do ON CONFLICT', () => {
  it('re-inserir 200 editais existentes não aumenta count; objeto é atualizado', async () => {
    await fx.pool.query('TRUNCATE editais');

    const SEED = 300;
    for (let i = 0; i < SEED; i++) {
      await fx.pool.query(UPSERT_SQL, upsertParams(gerarEdital(i)));
    }

    const { rows: antes } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM editais`,
      [],
    );

    // Re-upsert dos primeiros 200 com objeto modificado
    for (let i = 0; i < 200; i++) {
      const e = gerarEdital(i);
      await fx.pool.query(UPSERT_SQL, upsertParams({
        ...e,
        objeto: `[ATUALIZADO] ${e.objeto}`,
      }));
    }

    const { rows: depois } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM editais`,
      [],
    );
    expect(Number(depois[0]!.count)).toBe(Number(antes[0]!.count));

    const { rows: sample } = await fx.pool.query<{ objeto: string }>(
      `SELECT objeto FROM editais WHERE id = 'edital-0'`,
      [],
    );
    expect(sample[0]!.objeto).toContain('[ATUALIZADO]');
  });
});

// ---------------------------------------------------------------------------
// DB1c — Concorrência: 20 writers paralelos sem deadlock nem erro
// ---------------------------------------------------------------------------

describe('DB1c — 20 writers paralelos sem lock contention', () => {
  it('20 writers (10 editais cada) completam sem erro; todos os registros persistidos', async () => {
    await fx.pool.query('TRUNCATE editais');

    const WRITERS = 20;
    const PER_WRITER = 10;
    const BASE = 50_000; // IDs separados dos cenários anteriores

    const t0 = performance.now();

    await Promise.all(
      Array.from({ length: WRITERS }, (_, w) =>
        (async () => {
          for (let j = 0; j < PER_WRITER; j++) {
            const i = BASE + w * PER_WRITER + j;
            await fx.pool.query(UPSERT_SQL, upsertParams(gerarEdital(i)));
          }
        })(),
      ),
    );

    const elapsedS = (performance.now() - t0) / 1_000;
    const total = WRITERS * PER_WRITER;

    console.info(
      `[DB1c] ${total} upserts concorrentes (${WRITERS} writers) em ${elapsedS.toFixed(2)}s`,
    );

    const { rows } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM editais`,
      [],
    );
    expect(Number(rows[0]!.count)).toBe(total);
  });
});
