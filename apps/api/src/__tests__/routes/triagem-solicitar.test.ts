/**
 * Testes unitários: POST /api/triagem/:editalId/solicitar (RAD-80)
 *
 * Cobre: 202 happy path, 403 authz por objeto (P-51), 404 perfil/tenant não resolvido,
 * 400 editalId inválido e idempotência (rota retorna 202 mesmo para re-solicitação).
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AcessoNegadoError, EditalId, TenantId } from '@radar/kernel';
import type { Context } from 'hono';
import type { MiddlewareHandler } from 'hono';

// Bypass do autenticarMiddleware — testes de rota não testam o JWT (cobertura em auth-startup.test.ts)
vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('tenantId', TenantId('global'));
    return next();
  }) satisfies MiddlewareHandler,
}));

// Bypass do rate-limit por tenant — coberto isoladamente em rate-limit-tenant.test.ts (RAD-209)
vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarTriagemRouter } from '../../routes/triagem.js';
import type { TriagemContainer } from '../../routes/triagem.js';
import type {
  ConsultarTriagemUseCase,
  RegistrarFeedbackTriagemUseCase,
  SolicitarTriagemUseCase,
} from '@radar/triagem';

const EDITAL = 'edital-abc';
const SIGNAL = new AbortController().signal;

// RBAC (P-52) real é coberto em rbac.test.ts — aqui o gate é sempre-permite (bypassed)
const autorizarPermissivo: TriagemContainer['autorizar'] =
  () => (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

// Gate de cota (P-107 (3)) real é coberto em entitlement-middleware.test.ts — aqui sempre-permite
const entitlementPermissivo: TriagemContainer['entitlement'] =
  (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildApp(overrides?: Partial<TriagemContainer>): Hono {
  const container: TriagemContainer = {
    consultarTriagem: { executar: vi.fn().mockResolvedValue(null) } as unknown as ConsultarTriagemUseCase,
    solicitarTriagem: { executar: vi.fn().mockResolvedValue(undefined) } as unknown as SolicitarTriagemUseCase,
    registrarFeedback: { executar: vi.fn().mockResolvedValue(undefined) } as unknown as RegistrarFeedbackTriagemUseCase,
    perfilAtivo: {
      resolverParaTenant: vi.fn().mockResolvedValue({
        perfilId: 'perfil-1',
        clienteFinalId: 'cliente-1',
      }),
    },
    autorizar: autorizarPermissivo,
    entitlement: entitlementPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/triagem', criarTriagemRouter(container));
  return app;
}

describe('POST /api/triagem/:editalId/solicitar', () => {
  it('202 + { editalId, estado: processando } quando use case executa com sucesso', async () => {
    const app = buildApp();
    const res = await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });

    expect(res.status).toBe(202);
    const body = await res.json() as { editalId: string; estado: string };
    expect(body.editalId).toBe(EDITAL);
    expect(body.estado).toBe('processando');
  });

  it('403 quando SolicitarTriagemUseCase lança AcessoNegadoError (P-51)', async () => {
    const app = buildApp({
      solicitarTriagem: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as SolicitarTriagemUseCase,
    });

    const res = await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('404 quando PerfilAtivoGateway não resolve tenant', async () => {
    const app = buildApp({
      perfilAtivo: { resolverParaTenant: vi.fn().mockResolvedValue(null) },
    });

    const res = await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('propaga AbortSignal ao use case (P-78)', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      solicitarTriagem: { executar } as unknown as SolicitarTriagemUseCase,
    });

    await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });

    expect(executar).toHaveBeenCalledOnce();
    const [, signal] = executar.mock.calls[0]!;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('idempotência: re-solicitar retorna 202 (use case não duplica — invariante do use case)', async () => {
    // A idempotência real vive no SolicitarTriagemUseCase (não salva se existente).
    // Aqui garantimos que a rota retorna 202 a cada chamada sem erro de domínio.
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      solicitarTriagem: { executar } as unknown as SolicitarTriagemUseCase,
    });

    const r1 = await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });
    const r2 = await app.request(`/api/triagem/${EDITAL}/solicitar`, { method: 'POST' });

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(executar).toHaveBeenCalledTimes(2);
  });
});
