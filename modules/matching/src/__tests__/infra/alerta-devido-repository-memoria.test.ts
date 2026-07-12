import { describe, expect, it } from 'vitest';
import { AlertaId, EditalId, CriterioId, TenantId } from '@radar/kernel';
import { AlertaDevidoRepositoryMemoria } from '../../infra/adapters/alerta-devido-repository-memoria.js';

const signal = new AbortController().signal;

describe('AlertaDevidoRepositoryMemoria', () => {
  it('registrarLote acumula registros em memória', async () => {
    const repo = new AlertaDevidoRepositoryMemoria();
    const d = {
      alertaId: AlertaId('alerta-1'),
      editalId: EditalId('edital-1'),
      criterioId: CriterioId('criterio-1'),
      tenantId: TenantId('tenant-a'),
      prazoProposta: new Date('2026-09-01T00:00:00Z'),
    };

    await repo.registrarLote([d], signal);

    expect(repo.todos).toHaveLength(1);
    expect(repo.todos[0]).toEqual(d);
  });

  it('marcarNotificado grava o instante da primeira entrega', async () => {
    const repo = new AlertaDevidoRepositoryMemoria();
    const t = new Date('2026-07-12T10:00:00Z');

    await repo.marcarNotificado(AlertaId('alerta-1'), t, signal);

    expect(repo.notificadoEm(AlertaId('alerta-1'))).toEqual(t);
  });

  it('marcarNotificado é idempotente — segunda chamada não sobrescreve (A18 §5.2)', async () => {
    const repo = new AlertaDevidoRepositoryMemoria();
    const primeiro = new Date('2026-07-12T10:00:00Z');
    const segundo = new Date('2026-07-12T11:00:00Z');

    await repo.marcarNotificado(AlertaId('alerta-1'), primeiro, signal);
    await repo.marcarNotificado(AlertaId('alerta-1'), segundo, signal);

    expect(repo.notificadoEm(AlertaId('alerta-1'))).toEqual(primeiro);
  });

  it('notificadoEm retorna undefined para alertaId sem registro', () => {
    const repo = new AlertaDevidoRepositoryMemoria();

    expect(repo.notificadoEm(AlertaId('inexistente'))).toBeUndefined();
  });
});
