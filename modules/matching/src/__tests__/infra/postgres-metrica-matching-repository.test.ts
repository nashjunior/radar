import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { PostgresMetricaMatchingRepository } from '../../infra/adapters/postgres-metrica-matching-repository.js';

const signal = new AbortController().signal;

function criarDb(rows: object[]) {
  const chamadas: { sql: string; params: unknown[]; opts?: unknown }[] = [];
  return {
    chamadas,
    async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
      chamadas.push({ sql: _sql, params: _params, opts });
      return { rows: rows as R[] };
    },
  };
}

describe('PostgresMetricaMatchingRepository.precisao', () => {
  it('conta relevante=true como relevantes e relevante IS NOT NULL como comFeedback', async () => {
    const db = criarDb([{ relevantes: '7', com_feedback: '10' }]);
    const repo = new PostgresMetricaMatchingRepository(db);

    const resultado = await repo.precisao(TenantId('tenant-1'), signal);

    expect(resultado).toEqual({ relevantes: 7, comFeedback: 10 });
    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE relevante = true\)/);
    expect(sql).toMatch(/COUNT\(\*\) FILTER \(WHERE relevante IS NOT NULL\)/);
    expect(params[0]).toBe('tenant-1');
  });

  it('sem linhas → { relevantes: 0, comFeedback: 0 }', async () => {
    const db = criarDb([]);
    const repo = new PostgresMetricaMatchingRepository(db);

    const resultado = await repo.precisao(TenantId('tenant-1'), signal);

    expect(resultado).toEqual({ relevantes: 0, comFeedback: 0 });
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [{ relevantes: '0', com_feedback: '0' }] as R[] };
      },
    };
    const repo = new PostgresMetricaMatchingRepository(db);

    await repo.precisao(TenantId('t'), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresMetricaMatchingRepository.ativacao', () => {
  it('retorna ativados e total do resultado da CTE', async () => {
    const db = criarDb([{ total: '20', ativados: '15' }]);
    const repo = new PostgresMetricaMatchingRepository(db);

    const resultado = await repo.ativacao(TenantId('tenant-1'), 30, signal);

    expect(resultado).toEqual({ total: 20, ativados: 15 });
  });

  it('passa tenantId como $1 e janelaEmDias como $2', async () => {
    const db = criarDb([{ total: '0', ativados: '0' }]);
    const repo = new PostgresMetricaMatchingRepository(db);

    await repo.ativacao(TenantId('tenant-abc'), 7, signal);

    const { params } = db.chamadas[0]!;
    expect(params[0]).toBe('tenant-abc');
    expect(params[1]).toBe(7);
  });

  it('sem linhas → { total: 0, ativados: 0 }', async () => {
    const db = criarDb([]);
    const repo = new PostgresMetricaMatchingRepository(db);

    const resultado = await repo.ativacao(TenantId('tenant-1'), 30, signal);

    expect(resultado).toEqual({ total: 0, ativados: 0 });
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [{ total: '0', ativados: '0' }] as R[] };
      },
    };
    const repo = new PostgresMetricaMatchingRepository(db);

    await repo.ativacao(TenantId('t'), 30, ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
