/**
 * GET /api/me — cobre a distinção SEM_ORGANIZACAO (RAD-285) vs ACESSO_NEGADO,
 * separada da matriz RBAC (rbac.test.ts). AB3 é dublada (já coberta em
 * tenant-middleware.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import { ResolverContextoAutorizacaoUseCase, UsuarioId } from '@radar/identidade';
import type { PermissaoRepository } from '@radar/identidade';

const SUB = 'sub-1';
const TENANT = TenantId('tenant-1');

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('usuarioId', UsuarioId(SUB));
    c.set('tenantClaimId', null);
    c.set('usuarioEmail', null);
    return next();
  }) satisfies MiddlewareHandler,
}));

vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarMeRouter } from '../../routes/me.js';

function buildApp(permissoes: PermissaoRepository): Hono {
  const resolverContexto = new ResolverContextoAutorizacaoUseCase(permissoes);
  const app = new Hono();
  app.route('/api/me', criarMeRouter({ resolverContexto }));
  return app;
}

describe('GET /api/me', () => {
  it('200 com ContextoAutorizacaoDTO quando há atribuição', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue({ usuarioId: UsuarioId(SUB), tenantId: TENANT, papel: 'OPERADOR', clienteFinalIds: [] }),
      criar: vi.fn(),
    };
    const res = await buildApp(permissoes).request('/api/me');
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    expect(body.tenantId).toBe(TENANT);
  });

  it('403 SEM_ORGANIZACAO (não 403 cego) quando o sub autenticado não tem atribuição — sinal de onboarding', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue(null),
      criar: vi.fn(),
    };
    const res = await buildApp(permissoes).request('/api/me');
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SEM_ORGANIZACAO');
  });
});
