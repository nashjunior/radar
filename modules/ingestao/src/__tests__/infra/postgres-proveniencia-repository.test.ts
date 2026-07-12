import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { PostgresProvenienciaRepository } from '../../infra/adapters/postgres-proveniencia-repository.js';

const signal = new AbortController().signal;

function criarDb() {
  const chamadas: { sql: string; params: unknown[]; opts?: unknown }[] = [];
  return {
    chamadas,
    async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
      chamadas.push({ sql: _sql, params: _params, opts });
      return { rows: [] as R[] };
    },
  };
}

const PARAMS = {
  editalId: EditalId('edital-1'),
  fonte: 'PNCP',
  baseLegal: 'Lei 14.133/2021, art. 174',
  coletadoEm: new Date('2026-07-12T10:00:00Z'),
};

describe('PostgresProvenienciaRepository.registrar', () => {
  it('executa upsert ON CONFLICT (edital_id) DO UPDATE', async () => {
    const db = criarDb();
    const repo = new PostgresProvenienciaRepository(db);

    await repo.registrar(PARAMS, signal);

    const { sql } = db.chamadas[0]!;
    expect(sql).toMatch(/INSERT INTO proveniencias/);
    expect(sql).toMatch(/ON CONFLICT \(edital_id\) DO UPDATE/);
  });

  it('passa editalId, fonte e baseLegal como params', async () => {
    const db = criarDb();
    const repo = new PostgresProvenienciaRepository(db);

    await repo.registrar(PARAMS, signal);

    const { params } = db.chamadas[0]!;
    expect(params[0]).toBe('edital-1');
    expect(params[1]).toBe('PNCP');
    expect(params[2]).toBe('Lei 14.133/2021, art. 174');
  });

  it('serializa coletadoEm como ISO string', async () => {
    const db = criarDb();
    const repo = new PostgresProvenienciaRepository(db);

    await repo.registrar(PARAMS, signal);

    expect(db.chamadas[0]!.params[3]).toBe(PARAMS.coletadoEm.toISOString());
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresProvenienciaRepository(db);

    await repo.registrar(PARAMS, ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
