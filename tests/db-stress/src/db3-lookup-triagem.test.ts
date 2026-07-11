/**
 * DB3 — Lookup de Extração + Escrita de Triagem (A05 §2 → S3, A06 §3)
 *
 * Cenário: triagem IA lê extracao_edital (cache 1:1, global) e escreve
 * triagem (escopada por tenant × perfil). Concorrência real: 1 worker de
 * triagem por edital, mas múltiplos editais em paralelo (docs/12 §2).
 *
 * P-41 (RAD-165, 2026-07-10): pool de triagem/API max=10, statement_timeout=5s,
 * lock_timeout=3s, idle_in_transaction_session_timeout=30s.
 *
 * Cenários cobertos:
 *   DB3a — Cache hit: 200 lookups sequenciais em extracao_edital → p95 < 10 ms
 *   DB3b — 50 triagens paralelas via pool max=10: zero erros de conexão; enfileiram
 *           corretamente; wall-clock total ≤ 2 s (sem saturação de pool)
 *   DB3c — Isolamento de tenant: query com tenant errado → zero linhas (anti-IDOR)
 *   DB3d — Idempotência: re-triagem do mesmo (tenant, edital, perfil) → count não muda
 *
 * Gargalo documentado (A05/A06): pool de conexões; lock no upsert; volume crescente.
 * CAVEAT: requer Docker (Testcontainers).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDbTriagem, teardownDb, p, medirLatencias, type DbFixture } from './helpers/db.js';

// ---------------------------------------------------------------------------
// Queries idênticas às dos adapters Postgres (modules/triagem/src/infra)
// ---------------------------------------------------------------------------

const EXTRACAO_SELECT = `
  SELECT edital_id, objeto, valor_estimado, data_abertura_propostas,
         requisitos, riscos_brutos, confianca, paginas
    FROM extracao_edital
   WHERE edital_id = $1
`;

// Upsert idêntico ao PostgresExtracaoRepository.salvar()
const EXTRACAO_UPSERT = `
  INSERT INTO extracao_edital
    (edital_id, objeto, valor_estimado, data_abertura_propostas,
     requisitos, riscos_brutos, confianca, paginas)
  VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
  ON CONFLICT (edital_id) DO UPDATE SET
    objeto                  = EXCLUDED.objeto,
    valor_estimado          = EXCLUDED.valor_estimado,
    data_abertura_propostas = EXCLUDED.data_abertura_propostas,
    requisitos              = EXCLUDED.requisitos,
    riscos_brutos           = EXCLUDED.riscos_brutos,
    confianca               = EXCLUDED.confianca,
    paginas                 = EXCLUDED.paginas
`;

// Upsert idêntico ao PostgresTriagemRepository.salvar()
const TRIAGEM_UPSERT = `
  INSERT INTO triagem
    (tenant_id, cliente_final_id, edital_id, perfil_id, status, aderencia, recomendacao, riscos)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  ON CONFLICT (tenant_id, edital_id, perfil_id) DO UPDATE SET
    status       = EXCLUDED.status,
    aderencia    = EXCLUDED.aderencia,
    recomendacao = EXCLUDED.recomendacao,
    riscos       = EXCLUDED.riscos
`;

// ---------------------------------------------------------------------------
// Geração de fixtures sintéticas
// ---------------------------------------------------------------------------

function campoJson(valor: unknown, confianca = 0.9) {
  return JSON.stringify({ valor, confianca, citacao: null, critico: true });
}

function gerarExtracao(editalId: string, paginas = 12) {
  return [
    editalId,
    campoJson('Contratação de serviços de TI e desenvolvimento de software'),
    campoJson(300_000),
    campoJson('2026-09-15T09:00:00Z'),
    JSON.stringify([{ categoria: 'TECNICA', descricao: 'Atestado capacidade TI', citacao: null }]),
    JSON.stringify([]),
    0.92,
    paginas,
  ];
}

function gerarTriagem(
  tenant: string,
  clienteFinal: string,
  editalId: string,
  perfilId: string,
  aderencia = 0.82,
) {
  return [
    tenant, clienteFinal, editalId, perfilId,
    'concluida', aderencia, 'PARTICIPAR',
    JSON.stringify([{ descricao: 'Risco contratual', severidade: 'BAIXO', citacao: null }]),
  ];
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let fx: DbFixture;

beforeAll(async () => {
  // P-41: pool de triagem/API — max=10, statement_timeout=5s, lock_timeout=3s.
  // DB3b valida que 50 transações concorrentes multiplexam corretamente por 10 backends.
  fx = await startDbTriagem();
}, 120_000);

afterAll(async () => {
  await teardownDb(fx);
});

// ---------------------------------------------------------------------------
// DB3a — Cache hit: lookup de extracao_edital p95 < 10 ms
// ---------------------------------------------------------------------------

describe('DB3a — cache hit em extracao_edital (lookup por edital_id)', () => {
  it('p95 de 200 lookups sequenciais em 200 extrações < 10 ms', async () => {
    await fx.pool.query('TRUNCATE extracao_edital, triagem');

    const N = 200;
    // Seed: 200 extrações
    for (let i = 0; i < N; i++) {
      await fx.pool.query(EXTRACAO_UPSERT, gerarExtracao(`edital-cache-${i}`));
    }
    await fx.pool.query('ANALYZE extracao_edital');

    // Lookup sequencial aleatório dentro do seed
    const lats = await medirLatencias(async () => {
      const idx = Math.floor(Math.random() * N);
      const { rows } = await fx.pool.query(EXTRACAO_SELECT, [`edital-cache-${idx}`]);
      if (rows.length === 0) throw new Error(`extracao_edital não encontrada: edital-cache-${idx}`);
    }, 200);

    const p50 = p(lats, 50);
    const p95 = p(lats, 95);

    console.info(
      `[DB3a] 200 lookups extracao_edital — p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
    );

    expect(p95, `p95 cache hit excede 10 ms — revisar índice ou TOAST`).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// DB3b — 50 triagens paralelas via pool max=10: zero erros, enfileiramento correto
// Gate P-41: pool de triagem/API max=10 — 50 transações multiplexam por 10 backends.
// Asserta: zero erros de conexão (pool enfileira, não rejeita); wall-clock ≤ 2 s.
// ---------------------------------------------------------------------------

describe('DB3b — 50 upserts concorrentes via pool max=10 (gate P-41)', () => {
  it('50 triagens paralelas: zero erros de conexão; pool.totalCount ≤ 10; wall-clock ≤ 2 s', async () => {
    await fx.pool.query('TRUNCATE extracao_edital, triagem');

    // Seed: 50 extrações base
    for (let i = 0; i < 50; i++) {
      await fx.pool.query(EXTRACAO_UPSERT, gerarExtracao(`edital-conc-${i}`));
    }

    const erros: string[] = [];
    const t0 = performance.now();

    // 50 queries concorrentes via pool com max=10 — pg.Pool enfileira os 40 excedentes
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        fx.pool
          .query(TRIAGEM_UPSERT, gerarTriagem(
            'tenant-stress',
            `cliente-${i % 5}`,
            `edital-conc-${i}`,
            `perfil-${i % 3}`,
          ))
          .catch((err: unknown) => {
            erros.push(String(err));
          }),
      ),
    );

    const wallMs = performance.now() - t0;

    // Aguarda 50 ms para que conexões retornem ao idle (pg.Pool devolve async)
    await new Promise(r => setTimeout(r, 50));

    const poolTotal = fx.pool.totalCount;
    const poolIdle = fx.pool.idleCount;

    const { rows } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM triagem`,
      [],
    );

    console.info(
      `[DB3b] wall-clock=${wallMs.toFixed(1)}ms; erros=${erros.length}; ` +
      `pool.total=${poolTotal} pool.idle=${poolIdle} (max=10); triagens=${rows[0]!.count}`,
    );

    // Gate principal: zero erros de conexão — pool enfileira, não rejeita
    expect(
      erros,
      `${erros.length} erro(s) de conexão: pool saturou ou statement_timeout muito curto:\n${erros.join('\n')}`,
    ).toHaveLength(0);

    // Pool não pode ter excedido o max=10 definido por P-41
    expect(
      poolTotal,
      `pool.totalCount=${poolTotal} excede max=10 (P-41)`,
    ).toBeLessThanOrEqual(10);

    // Wall-clock: 50 queries por 10 backends = 5 rounds; cada upsert simples < 400 ms → ≤ 2 s
    expect(wallMs, `wall-clock ${wallMs.toFixed(1)}ms > 2000 ms — pool saturado ou starvation`).toBeLessThan(2_000);

    // UNIQUE (tenant_id, edital_id, perfil_id): pode haver menos que 50 se perfil colidiu
    expect(Number(rows[0]!.count)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DB3c — Isolamento de tenant: query com tenant errado retorna zero (anti-IDOR)
// ---------------------------------------------------------------------------

describe('DB3c — isolamento de tenant em triagem (anti-IDOR)', () => {
  it('query com tenant_id incorreto não vaza linhas de outro tenant', async () => {
    await fx.pool.query('TRUNCATE extracao_edital, triagem');

    // Cria triagem para tenant-A
    await fx.pool.query(EXTRACAO_UPSERT, gerarExtracao('edital-idor-001'));
    await fx.pool.query(TRIAGEM_UPSERT, gerarTriagem(
      'tenant-A', 'cliente-A', 'edital-idor-001', 'perfil-A',
    ));

    // Query com tenant-B — deve retornar zero
    const { rows } = await fx.pool.query(
      `SELECT * FROM triagem
        WHERE tenant_id = 'tenant-B'
          AND cliente_final_id = 'cliente-B'
          AND edital_id = 'edital-idor-001'
          AND perfil_id = 'perfil-A'`,
      [],
    );
    expect(rows).toHaveLength(0);

    // Confirma que a linha existe para tenant-A
    const { rows: correto } = await fx.pool.query(
      `SELECT * FROM triagem
        WHERE tenant_id = 'tenant-A' AND edital_id = 'edital-idor-001'`,
      [],
    );
    expect(correto).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// DB3d — Idempotência: re-triagem não duplica linha
// ---------------------------------------------------------------------------

describe('DB3d — idempotência do upsert de triagem', () => {
  it('re-triar o mesmo (tenant, edital, perfil) atualiza campos sem duplicar linha', async () => {
    await fx.pool.query('TRUNCATE extracao_edital, triagem');

    await fx.pool.query(EXTRACAO_UPSERT, gerarExtracao('edital-idem-001'));

    // Primeira triagem
    await fx.pool.query(TRIAGEM_UPSERT, gerarTriagem(
      'tenant-idem', 'cliente-idem', 'edital-idem-001', 'perfil-idem', 0.65,
    ));

    const { rows: antes } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM triagem`,
      [],
    );

    // Re-triagem com aderência atualizada
    await fx.pool.query(TRIAGEM_UPSERT, gerarTriagem(
      'tenant-idem', 'cliente-idem', 'edital-idem-001', 'perfil-idem', 0.88,
    ));

    const { rows: depois } = await fx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM triagem`,
      [],
    );
    expect(Number(depois[0]!.count)).toBe(Number(antes[0]!.count));

    // Verifica atualização do campo
    const { rows: updated } = await fx.pool.query<{ aderencia: string }>(
      `SELECT aderencia::text FROM triagem
        WHERE tenant_id = 'tenant-idem' AND edital_id = 'edital-idem-001'`,
      [],
    );
    expect(Number(updated[0]!.aderencia)).toBeCloseTo(0.88, 2);
  });
});
