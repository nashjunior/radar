/**
 * Testes unitários: GET /api/me/assinatura e POST /api/checkout/iniciar (RAD-264)
 *
 * Cobre: 200 happy path de cada rota, 404 sem assinatura/plano, 400 corpo
 * inválido do checkout, tenantId sempre do contexto de auth (nunca body).
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import { AssinaturaNaoEncontradaError, PlanoComercialNaoEncontradoError } from '@radar/cobranca';
import type { AssinaturaDTO, ConsultarAssinaturaUseCase, IniciarCheckoutUseCase } from '@radar/cobranca';

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('tenantId', TenantId('tenant-1'));
    return next();
  }) satisfies MiddlewareHandler,
}));

vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarAssinaturaRouter, criarCheckoutRouter } from '../../routes/cobranca.js';
import type { AssinaturaContainer, CheckoutContainer } from '../../routes/cobranca.js';

const DTO_ATIVA: AssinaturaDTO = {
  estado: 'ativa',
  plano: { codigo: 'pro', cota: 150 },
  usoReservado: 10,
  usoConfirmado: 40,
  diasRestantes: 12,
};

// Resolução de organização (RAD-285) real é coberta em exigir-organizacao-middleware.test.ts — aqui sempre-permite
const exigirOrganizacaoPermissivo: AssinaturaContainer['exigirOrganizacao'] =
  (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildAssinaturaApp(overrides?: Partial<AssinaturaContainer>): Hono {
  const container: AssinaturaContainer = {
    consultarAssinatura: {
      executar: vi.fn().mockResolvedValue(DTO_ATIVA),
    } as unknown as ConsultarAssinaturaUseCase,
    exigirOrganizacao: exigirOrganizacaoPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/me/assinatura', criarAssinaturaRouter(container));
  return app;
}

function buildCheckoutApp(overrides?: Partial<CheckoutContainer>): Hono {
  const container: CheckoutContainer = {
    iniciarCheckout: {
      executar: vi.fn().mockResolvedValue({ urlCheckout: 'https://checkout.fake/abc123' }),
    } as unknown as IniciarCheckoutUseCase,
    exigirOrganizacao: exigirOrganizacaoPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/checkout', criarCheckoutRouter(container));
  return app;
}

describe('GET /api/me/assinatura', () => {
  it('200 + AssinaturaDTO quando o use case executa com sucesso', async () => {
    const app = buildAssinaturaApp();
    const res = await app.request(new Request('http://localhost/api/me/assinatura'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DTO_ATIVA);
  });

  it('404 quando o tenant não tem Assinatura provisionada', async () => {
    const app = buildAssinaturaApp({
      consultarAssinatura: {
        executar: vi.fn().mockRejectedValue(new AssinaturaNaoEncontradaError(TenantId('tenant-1'))),
      } as unknown as ConsultarAssinaturaUseCase,
    });

    const res = await app.request(new Request('http://localhost/api/me/assinatura'));
    expect(res.status).toBe(404);
  });

  it('deriva tenantId do contexto de auth, nunca de query/header', async () => {
    const executar = vi.fn().mockResolvedValue(DTO_ATIVA);
    const app = buildAssinaturaApp({ consultarAssinatura: { executar } as unknown as ConsultarAssinaturaUseCase });

    await app.request(
      new Request('http://localhost/api/me/assinatura?tenantId=outro-tenant', {
        headers: { 'x-tenant-id': 'outro-tenant' },
      }),
    );

    expect(executar).toHaveBeenCalledExactlyOnceWith({ tenantId: TenantId('tenant-1') }, expect.any(AbortSignal));
  });
});

describe('POST /api/checkout/iniciar', () => {
  function req(body: unknown) {
    return new Request('http://localhost/api/checkout/iniciar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('200 + { urlCheckout } quando o use case executa com sucesso', async () => {
    const app = buildCheckoutApp();
    const res = await app.request(req({ planoCodigo: 'pro' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ urlCheckout: 'https://checkout.fake/abc123' });
  });

  it('400 quando planoCodigo está ausente', async () => {
    const app = buildCheckoutApp();
    const res = await app.request(req({}));
    expect(res.status).toBe(400);
  });

  it('400 quando corpo traz campo extra fora do schema', async () => {
    const app = buildCheckoutApp();
    const res = await app.request(req({ planoCodigo: 'pro', tenantId: 'tenant-injetado' }));
    expect(res.status).toBe(400);
  });

  it('404 quando planoCodigo não existe no catálogo', async () => {
    const app = buildCheckoutApp({
      iniciarCheckout: {
        executar: vi.fn().mockRejectedValue(new PlanoComercialNaoEncontradoError('inexistente')),
      } as unknown as IniciarCheckoutUseCase,
    });

    const res = await app.request(req({ planoCodigo: 'inexistente' }));
    expect(res.status).toBe(404);
  });

  it('deriva tenantId do contexto de auth (corpo só aceita planoCodigo, RAD-264)', async () => {
    const executar = vi.fn().mockResolvedValue({ urlCheckout: 'https://checkout.fake/x' });
    const app = buildCheckoutApp({ iniciarCheckout: { executar } as unknown as IniciarCheckoutUseCase });

    await app.request(req({ planoCodigo: 'pro' }));

    expect(executar).toHaveBeenCalledExactlyOnceWith(
      { tenantId: TenantId('tenant-1'), planoCodigo: 'pro' },
      expect.any(AbortSignal),
    );
  });
});
