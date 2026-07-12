import { describe, expect, it } from 'vitest';
import { PostgresCoberturaPrazoCriticoRepository } from '../../infra/adapters/postgres-cobertura-prazo-critico-repository.js';

const signal = new AbortController().signal;

function criarDb(row: { elegivel: string; coberto: string }) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  return {
    chamadas,
    async query<R extends object>(sql: string, params: unknown[]): Promise<{ rows: R[] }> {
      chamadas.push({ sql, params });
      return { rows: [row] as unknown as R[] };
    },
  };
}

describe('PostgresCoberturaPrazoCriticoRepository.contar', () => {
  it('lê só a projeção local alerta_devido (join intra-contexto com alerta) — sem tocar outro schema', async () => {
    const db = criarDb({ elegivel: '10', coberto: '7' });
    const repo = new PostgresCoberturaPrazoCriticoRepository(db);

    const resultado = await repo.contar({ agora: new Date('2026-07-12T00:00:00Z'), diasLimiar: 3 }, signal);

    expect(resultado).toEqual({ elegivel: 10, coberto: 7 });
    expect(db.chamadas).toHaveLength(1);
    const { sql } = db.chamadas[0]!;
    expect(sql).toMatch(/FROM alerta_devido ad/);
    expect(sql).toMatch(/LEFT JOIN alerta a ON a\.id = ad\.alerta_id/);
    expect(sql).not.toMatch(/editais|edital_anexos|notificacao\b/);
  });

  it('janela = [agora, agora + diasLimiar dias], nos dois extremos (BETWEEN inclusivo)', async () => {
    const db = criarDb({ elegivel: '0', coberto: '0' });
    const repo = new PostgresCoberturaPrazoCriticoRepository(db);
    const agora = new Date('2026-07-12T00:00:00Z');

    await repo.contar({ agora, diasLimiar: 3 }, signal);

    const { params } = db.chamadas[0]!;
    expect(params[0]).toEqual(agora);
    expect(params[1]).toEqual(new Date('2026-07-15T00:00:00Z'));
  });

  it('coberto exige alerta persistido (a.id IS NOT NULL) E notificado_em preenchido', async () => {
    const db = criarDb({ elegivel: '1', coberto: '0' });
    const repo = new PostgresCoberturaPrazoCriticoRepository(db);

    await repo.contar({ agora: new Date(), diasLimiar: 3 }, signal);

    const { sql } = db.chamadas[0]!;
    expect(sql).toMatch(/a\.id IS NOT NULL/);
    expect(sql).toMatch(/ad\.notificado_em IS NOT NULL/);
  });

  it('sem linhas na projeção → { elegivel: 0, coberto: 0 }', async () => {
    const db = {
      async query<R extends object>(): Promise<{ rows: R[] }> {
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresCoberturaPrazoCriticoRepository(db);

    const resultado = await repo.contar({ agora: new Date(), diasLimiar: 3 }, signal);

    expect(resultado).toEqual({ elegivel: 0, coberto: 0 });
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [{ elegivel: '0', coberto: '0' }] as unknown as R[] };
      },
    };
    const repo = new PostgresCoberturaPrazoCriticoRepository(db);

    await repo.contar({ agora: new Date(), diasLimiar: 3 }, ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
