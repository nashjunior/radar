/**
 * POST /api/organizacoes — onboarding self-signup (RAD-285). AB3 é dublada
 * (já coberta em tenant-middleware.test.ts); aqui o foco é o contrato HTTP e
 * o mapeamento de erros de domínio.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import { CnpjInvalidoError, OrganizacaoJaExisteError, UsuarioId } from '@radar/identidade';
import type { ProvisionarOrganizacaoUseCase } from '@radar/identidade';

const SUB = 'sub-novo';

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('usuarioId', UsuarioId(SUB));
    c.set('usuarioEmail', 'novo@empresa.com');
    return next();
  }) satisfies MiddlewareHandler,
}));

vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarOrganizacoesRouter } from '../../routes/organizacoes.js';

const CNPJ_VALIDO = '11222333000181';
const DTO_OK = { tenantId: TenantId('tenant-novo'), cnpj: CNPJ_VALIDO, razaoSocial: 'Empresa LTDA', papel: 'ADMIN_CONSULTORIA' };

function buildApp(overrides?: Partial<ProvisionarOrganizacaoUseCase>): Hono {
  const provisionarOrganizacao = {
    executar: vi.fn().mockResolvedValue(DTO_OK),
    ...overrides,
  } as unknown as ProvisionarOrganizacaoUseCase;

  const app = new Hono();
  app.route('/api/organizacoes', criarOrganizacoesRouter({ provisionarOrganizacao }));
  return app;
}

describe('POST /api/organizacoes', () => {
  it('201 e OrganizacaoDTO no happy path, repassando sub/email do token', async () => {
    const executar = vi.fn().mockResolvedValue(DTO_OK);
    const app = buildApp({ executar });

    const res = await app.request('/api/organizacoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cnpj: CNPJ_VALIDO, razaoSocial: 'Empresa LTDA' }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(DTO_OK);
    expect(executar).toHaveBeenCalledWith(
      { sub: SUB, email: 'novo@empresa.com', cnpj: CNPJ_VALIDO, razaoSocial: 'Empresa LTDA' },
      expect.anything(),
    );
  });

  it('400 CORPO_INVALIDO quando cnpj/razaoSocial ausentes', async () => {
    const app = buildApp();
    const res = await app.request('/api/organizacoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CORPO_INVALIDO');
  });

  it('422 CNPJ_INVALIDO quando o use case rejeita o dígito verificador', async () => {
    const app = buildApp({ executar: vi.fn().mockRejectedValue(new CnpjInvalidoError('DV inválido')) });
    const res = await app.request('/api/organizacoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cnpj: '111', razaoSocial: 'Empresa LTDA' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CNPJ_INVALIDO');
  });

  it('409 ORGANIZACAO_JA_EXISTE quando o CNPJ já pertence a outro tenant', async () => {
    const app = buildApp({ executar: vi.fn().mockRejectedValue(new OrganizacaoJaExisteError()) });
    const res = await app.request('/api/organizacoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cnpj: CNPJ_VALIDO, razaoSocial: 'Empresa LTDA' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ORGANIZACAO_JA_EXISTE');
  });
});
