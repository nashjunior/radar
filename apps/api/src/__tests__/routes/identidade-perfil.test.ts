/**
 * Testes unitários: GET /api/identidade/perfil (P-101) e PUT /api/identidade/perfil (RAD-109)
 *
 * Cobre GET: 200 + DTO, 404 sem perfil ativo, 404 quando perfil não existe,
 *            authz por objeto (P-51), AbortSignal (P-78), DTO sem tenantId.
 * Cobre PUT: 200 happy path (smoke), 400 corpo inválido, 404 sem perfil ativo.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId, ClienteFinalId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import type { ConsultarPerfilHabilitacaoUseCase, GerenciarPerfilHabilitacaoUseCase } from '@radar/identidade';

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

import { criarIdentidadeRouter } from '../../routes/identidade.js';
import type { IdentidadeContainer } from '../../routes/identidade.js';
import type { PerfilAtivoGateway } from '../../ports/perfil-ativo-gateway.js';

const TENANT = TenantId('tenant-1');
const CLIENTE = ClienteFinalId('cliente-1');

const PERFIL_DTO = {
  id: 'perfil-1',
  clienteFinalId: CLIENTE,
  habJuridica: ['doc-j'],
  habFiscal: [],
  habTecnica: [],
  habEconomica: [],
};

const perfilAtivoOk: PerfilAtivoGateway = {
  resolverParaTenant: vi.fn().mockResolvedValue({ clienteFinalId: CLIENTE }),
};

const perfilAtivoVazio: PerfilAtivoGateway = {
  resolverParaTenant: vi.fn().mockResolvedValue(null),
};

// RBAC (P-52) real é coberto em rbac.test.ts — aqui o gate é sempre-permite (bypassed)
const autorizarPermissivo: IdentidadeContainer['autorizar'] =
  () => (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildApp(overrides?: Partial<IdentidadeContainer>): Hono {
  const container: IdentidadeContainer = {
    consultarPerfil: {
      executar: vi.fn().mockResolvedValue(PERFIL_DTO),
    } as unknown as ConsultarPerfilHabilitacaoUseCase,
    gerenciarPerfil: {
      executar: vi.fn().mockResolvedValue(PERFIL_DTO),
    } as unknown as GerenciarPerfilHabilitacaoUseCase,
    perfilAtivo: perfilAtivoOk,
    autorizar: autorizarPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/identidade', criarIdentidadeRouter(container));
  return app;
}

const GET_URL = 'http://localhost/api/identidade/perfil';

describe('GET /api/identidade/perfil', () => {
  it('200 + PerfilDTO quando perfil existe', async () => {
    const app = buildApp();
    const res = await app.request(new Request(GET_URL));

    expect(res.status).toBe(200);
    const body = await res.json() as typeof PERFIL_DTO;
    expect(body.clienteFinalId).toBe(CLIENTE);
    expect(body.habJuridica).toEqual(['doc-j']);
  });

  it('DTO não contém tenantId (P-101)', async () => {
    const app = buildApp();
    const res = await app.request(new Request(GET_URL));
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('tenantId');
  });

  it('404 quando perfil ativo não encontrado para o tenant', async () => {
    const app = buildApp({ perfilAtivo: perfilAtivoVazio });
    const res = await app.request(new Request(GET_URL));
    expect(res.status).toBe(404);
  });

  it('404 quando use case retorna null (perfil não existe)', async () => {
    const app = buildApp({
      consultarPerfil: {
        executar: vi.fn().mockResolvedValue(null),
      } as unknown as ConsultarPerfilHabilitacaoUseCase,
    });
    const res = await app.request(new Request(GET_URL));
    expect(res.status).toBe(404);
  });

  it('propaga AbortSignal ao use case (P-78)', async () => {
    const executar = vi.fn().mockResolvedValue(PERFIL_DTO);
    const app = buildApp({ consultarPerfil: { executar } as unknown as ConsultarPerfilHabilitacaoUseCase });

    await app.request(new Request(GET_URL));

    const [, signal] = executar.mock.calls[0]!;
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('PUT /api/identidade/perfil', () => {
  const PUT_BODY = { habJuridica: ['doc-j'], habFiscal: [], habTecnica: [], habEconomica: [] };

  it('200 + PerfilDTO no upsert', async () => {
    const app = buildApp();
    const res = await app.request(new Request(GET_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PUT_BODY),
    }));
    expect(res.status).toBe(200);
  });

  it('400 quando corpo inválido', async () => {
    const app = buildApp();
    const res = await app.request(new Request(GET_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ habJuridica: 'errado' }),
    }));
    expect(res.status).toBe(400);
  });

  it('400 quando corpo tenta mass assignment com campo fora do schema', async () => {
    const app = buildApp();
    const res = await app.request(new Request(GET_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...PUT_BODY, tenantId: 'tenant-injetado' }),
    }));
    expect(res.status).toBe(400);
  });

  it('404 quando perfil ativo não encontrado', async () => {
    const app = buildApp({ perfilAtivo: perfilAtivoVazio });
    const res = await app.request(new Request(GET_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PUT_BODY),
    }));
    expect(res.status).toBe(404);
  });
});
