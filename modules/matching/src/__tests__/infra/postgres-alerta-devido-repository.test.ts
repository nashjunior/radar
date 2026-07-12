import { describe, expect, it } from 'vitest';
import { AlertaId, EditalId, CriterioId, TenantId } from '@radar/kernel';
import { PostgresAlertaDevidoRepository } from '../../infra/adapters/postgres-alerta-devido-repository.js';
import type { AlertaDevidoRegistro } from '../../application/ports.js';

const signal = new AbortController().signal;

function criarDb() {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  return {
    chamadas,
    async query<R extends object>(sql: string, params: unknown[]): Promise<{ rows: R[] }> {
      chamadas.push({ sql, params });
      return { rows: [] as R[] };
    },
  };
}

function devidos(n: number): AlertaDevidoRegistro[] {
  return Array.from({ length: n }, (_, i) => ({
    alertaId: AlertaId(`alerta-${i + 1}`),
    editalId: EditalId(`edital-${i + 1}`),
    criterioId: CriterioId(`criterio-${i + 1}`),
    tenantId: TenantId('tenant-a'),
    prazoProposta: new Date('2026-09-01T00:00:00Z'),
  }));
}

describe('PostgresAlertaDevidoRepository.registrarLote', () => {
  it('array vazio retorna sem executar query (early return)', async () => {
    const db = criarDb();
    const repo = new PostgresAlertaDevidoRepository(db);

    await repo.registrarLote([], signal);

    expect(db.chamadas).toHaveLength(0);
  });

  it('1 item → INSERT com placeholder ($1,$2,$3,$4,$5,NOW())', async () => {
    const db = criarDb();
    const repo = new PostgresAlertaDevidoRepository(db);
    const [d] = devidos(1);

    await repo.registrarLote([d!], signal);

    expect(db.chamadas).toHaveLength(1);
    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/INSERT INTO alerta_devido/);
    expect(sql).toMatch(/\(\$1,\$2,\$3,\$4,\$5,NOW\(\)\)/);
    expect(sql).toMatch(/ON CONFLICT \(alerta_id\) DO NOTHING/);
    expect(params).toEqual([d!.alertaId, d!.editalId, d!.criterioId, d!.tenantId, d!.prazoProposta]);
  });

  it('2 itens → placeholders consecutivos e params achatados', async () => {
    const db = criarDb();
    const repo = new PostgresAlertaDevidoRepository(db);
    const [d1, d2] = devidos(2);

    await repo.registrarLote([d1!, d2!], signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/\(\$1,\$2,\$3,\$4,\$5,NOW\(\)\),\(\$6,\$7,\$8,\$9,\$10,NOW\(\)\)/);
    expect(params).toEqual([
      d1!.alertaId, d1!.editalId, d1!.criterioId, d1!.tenantId, d1!.prazoProposta,
      d2!.alertaId, d2!.editalId, d2!.criterioId, d2!.tenantId, d2!.prazoProposta,
    ]);
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
    const repo = new PostgresAlertaDevidoRepository(db);

    await repo.registrarLote(devidos(1), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresAlertaDevidoRepository.marcarNotificado', () => {
  it('faz UPDATE de notificado_em chaveado por alerta_id', async () => {
    const db = criarDb();
    const repo = new PostgresAlertaDevidoRepository(db);
    const notificadoEm = new Date('2026-01-01T12:00:00Z');

    await repo.marcarNotificado(AlertaId('alerta-1'), notificadoEm, signal);

    expect(db.chamadas).toHaveLength(1);
    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/UPDATE alerta_devido/);
    expect(sql).toMatch(/WHERE alerta_id = \$2/);
    expect(params).toEqual([notificadoEm, AlertaId('alerta-1')]);
  });

  it('a cláusula garante idempotência — não sobrescreve notificado_em já preenchido', async () => {
    const db = criarDb();
    const repo = new PostgresAlertaDevidoRepository(db);

    await repo.marcarNotificado(AlertaId('alerta-1'), new Date(), signal);

    expect(db.chamadas[0]!.sql).toMatch(/AND notificado_em IS NULL/);
  });

  it('alerta sem linha na projeção não lança — UPDATE de 0 linhas é sucesso', async () => {
    const db = criarDb(); // fake sempre resolve, simulando 0 linhas afetadas sem erro
    const repo = new PostgresAlertaDevidoRepository(db);

    await expect(repo.marcarNotificado(AlertaId('alerta-inexistente'), new Date(), signal)).resolves.toBeUndefined();
  });

  it('propaga AbortSignal ao db.query (P-78)', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresAlertaDevidoRepository(db);

    await repo.marcarNotificado(AlertaId('alerta-1'), new Date(), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
