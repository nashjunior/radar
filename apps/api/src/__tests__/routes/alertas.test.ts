/**
 * Testes unitários: GET /api/alertas (US-05)
 *
 * Cobre: 200 lista vazia, 200 lista com alertas (incluindo proveniência),
 * authz por objeto (tenantId scopa a consulta), AbortSignal passado ao use case.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId } from '@radar/kernel';
import type { Context } from 'hono';
import type { MiddlewareHandler } from 'hono';

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('tenantId', TenantId('tenant-1'));
    return next();
  }) satisfies MiddlewareHandler,
}));

// Bypass do rate-limit por tenant — coberto isoladamente em rate-limit-tenant.test.ts (RAD-209)
vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarAlertasRouter } from '../../routes/alertas.js';
import type { AlertasContainer } from '../../routes/alertas.js';
import type { ConsultarAlertasTenantUseCase } from '@radar/matching';

const ALERTA_DTO = {
  id: 'alerta-1',
  tenantId: 'tenant-1',
  clienteFinalId: 'cf-1',
  criterioId: 'crit-1',
  editalId: 'edital-1',
  aderencia: 0.8,
  relevante: null,
};

const ALERTA_COM_PROVENIENCIA = {
  ...ALERTA_DTO,
  id: 'alerta-2',
  proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', dataColeta: '2026-07-09T00:00:00.000Z' },
};

// RBAC (P-52) real é coberto em rbac.test.ts — aqui o gate é sempre-permite (bypassed)
const autorizarPermissivo: AlertasContainer['autorizar'] =
  () => (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildApp(overrides?: Partial<AlertasContainer>): Hono {
  const container: AlertasContainer = {
    consultarAlertas: {
      executar: vi.fn().mockResolvedValue([]),
    } as unknown as ConsultarAlertasTenantUseCase,
    autorizar: autorizarPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/alertas', criarAlertasRouter(container));
  return app;
}

const URL = 'http://localhost/api/alertas';

describe('GET /api/alertas', () => {
  it('200 + [] quando não há alertas', async () => {
    const app = buildApp();
    const res = await app.request(new Request(URL));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('200 + lista de AlertaDTO quando há alertas', async () => {
    const app = buildApp({
      consultarAlertas: {
        executar: vi.fn().mockResolvedValue([ALERTA_DTO]),
      } as unknown as ConsultarAlertasTenantUseCase,
    });

    const res = await app.request(new Request(URL));
    expect(res.status).toBe(200);
    const body = await res.json() as typeof ALERTA_DTO[];
    expect(body).toHaveLength(1);
    const alerta = body[0]!;
    expect(alerta.id).toBe('alerta-1');
    expect(alerta.aderencia).toBe(0.8);
  });

  it('200 + proveniência incluída quando presente no DTO', async () => {
    const app = buildApp({
      consultarAlertas: {
        executar: vi.fn().mockResolvedValue([ALERTA_COM_PROVENIENCIA]),
      } as unknown as ConsultarAlertasTenantUseCase,
    });

    const res = await app.request(new Request(URL));
    expect(res.status).toBe(200);
    const body = await res.json() as typeof ALERTA_COM_PROVENIENCIA[];
    expect(body[0]!.proveniencia?.fonte).toBe('PNCP');
  });

  it('tenantId do JWT é passado ao use case (authz por objeto)', async () => {
    const executar = vi.fn().mockResolvedValue([]);
    const app = buildApp({
      consultarAlertas: { executar } as unknown as ConsultarAlertasTenantUseCase,
    });

    await app.request(new Request(URL));

    expect(executar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      expect.any(AbortSignal),
    );
  });

  it('AbortSignal é propagado ao use case', async () => {
    const executar = vi.fn().mockResolvedValue([]);
    const app = buildApp({
      consultarAlertas: { executar } as unknown as ConsultarAlertasTenantUseCase,
    });

    await app.request(new Request(URL));

    const [, signal] = executar.mock.calls[0] as [unknown, AbortSignal];
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
