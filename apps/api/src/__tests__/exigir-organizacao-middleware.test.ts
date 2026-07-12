/**
 * Testes runtime do exigirOrganizacaoMiddleware (RAD-285).
 *
 * Isolado do JWT (AB3, já coberto em tenant-middleware.test.ts): injeta
 * usuarioId/tenantClaimId diretamente no Context antes do middleware sob teste.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId } from '@radar/kernel';
import { ResolverContextoAutorizacaoUseCase, UsuarioId } from '@radar/identidade';
import type { PermissaoRepository } from '@radar/identidade';
import { criarExigirOrganizacaoMiddleware } from '../middleware/tenant.js';

const TENANT = TenantId('tenant-1');
const SUB = 'sub-com-organizacao';
const SUB_SEM_ORG = 'sub-sem-organizacao';

function buildApp(permissoes: PermissaoRepository, usuarioId: string, tenantClaimId: string | null = null) {
  const resolverContexto = new ResolverContextoAutorizacaoUseCase(permissoes);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('usuarioId', UsuarioId(usuarioId));
    c.set('tenantClaimId', tenantClaimId ? TenantId(tenantClaimId) : null);
    await next();
  });
  app.use('*', criarExigirOrganizacaoMiddleware({ resolverContexto }));
  app.get('/ping', (c) => c.json({ tenantId: c.get('tenantId') }));
  return app;
}

describe('exigirOrganizacaoMiddleware', () => {
  it('200 e tenantId resolvido do PermissaoRepository quando há atribuição', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue({ usuarioId: UsuarioId(SUB), tenantId: TENANT, papel: 'OPERADOR', clienteFinalIds: [] }),
      criar: vi.fn(),
    };
    const app = buildApp(permissoes, SUB);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    expect(body.tenantId).toBe(TENANT);
  });

  it('403 SEM_ORGANIZACAO quando o sub não tem atribuição (não é 403 cego)', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue(null),
      criar: vi.fn(),
    };
    const app = buildApp(permissoes, SUB_SEM_ORG);
    const res = await app.request('/ping');
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('SEM_ORGANIZACAO');
  });

  it('403 ACESSO_NEGADO quando tenantClaimId presente diverge do tenantId da atribuição', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue({ usuarioId: UsuarioId(SUB), tenantId: TENANT, papel: 'OPERADOR', clienteFinalIds: [] }),
      criar: vi.fn(),
    };
    const app = buildApp(permissoes, SUB, 'outro-tenant');
    const res = await app.request('/ping');
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ACESSO_NEGADO');
  });

  it('200 quando tenantClaimId presente e confere com o registro', async () => {
    const permissoes: PermissaoRepository = {
      buscarPorUsuario: vi.fn().mockResolvedValue({ usuarioId: UsuarioId(SUB), tenantId: TENANT, papel: 'OPERADOR', clienteFinalIds: [] }),
      criar: vi.fn(),
    };
    const app = buildApp(permissoes, SUB, TENANT);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
  });
});
