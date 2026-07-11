/**
 * Testes unitários: PUT /api/notificacao/preferencias (US-10)
 *
 * Cobre: 200 happy path, 400 corpo inválido, 422 canal inválido,
 * 403 authz por objeto (P-51), AbortSignal (P-78).
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AcessoNegadoError, TenantId } from '@radar/kernel';
import type { Context } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { CanalInvalidoError } from '@radar/notificacao';

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('tenantId', TenantId('tenant-1'));
    return next();
  }) satisfies MiddlewareHandler,
}));

import { criarNotificacaoRouter } from '../../routes/notificacao.js';
import type { NotificacaoContainer } from '../../routes/notificacao.js';
import type { DefinirPreferenciasNotificacaoUseCase } from '@radar/notificacao';

const BODY_VALIDO = { canais: ['EMAIL'], frequencia: 'DIARIA' };

function buildApp(overrides?: Partial<NotificacaoContainer>): Hono {
  const container: NotificacaoContainer = {
    definirPreferencias: {
      executar: vi.fn().mockResolvedValue({
        usuarioId: 'tenant-1',
        canais: ['EMAIL'],
        frequencia: 'DIARIA',
      }),
    } as unknown as DefinirPreferenciasNotificacaoUseCase,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/notificacao', criarNotificacaoRouter(container));
  return app;
}

function req(body: unknown) {
  return new Request('http://localhost/api/notificacao/preferencias', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/notificacao/preferencias', () => {
  it('200 + PreferenciaDTO quando use case executa com sucesso', async () => {
    const app = buildApp();
    const res = await app.request(req(BODY_VALIDO));

    expect(res.status).toBe(200);
    const body = await res.json() as { canais: string[]; frequencia: string };
    expect(body.canais).toEqual(['EMAIL']);
    expect(body.frequencia).toBe('DIARIA');
  });

  it('400 quando corpo está ausente', async () => {
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/api/notificacao/preferencias', { method: 'PUT' }));
    expect(res.status).toBe(400);
  });

  it('400 quando canais está ausente', async () => {
    const app = buildApp();
    const res = await app.request(req({ frequencia: 'DIARIA' }));
    expect(res.status).toBe(400);
  });

  it('400 quando frequencia está ausente', async () => {
    const app = buildApp();
    const res = await app.request(req({ canais: ['EMAIL'] }));
    expect(res.status).toBe(400);
  });

  it('400 quando corpo traz campo extra fora do schema', async () => {
    const app = buildApp();
    const res = await app.request(req({ ...BODY_VALIDO, usuarioId: 'usuario-injetado' }));
    expect(res.status).toBe(400);
  });

  it('422 quando use case lança CanalInvalidoError', async () => {
    const app = buildApp({
      definirPreferencias: {
        executar: vi.fn().mockRejectedValue(new CanalInvalidoError('SMS')),
      } as unknown as DefinirPreferenciasNotificacaoUseCase,
    });

    const res = await app.request(req({ canais: ['SMS'], frequencia: 'DIARIA' }));
    expect(res.status).toBe(422);
  });

  it('403 quando use case lança AcessoNegadoError (P-51)', async () => {
    const app = buildApp({
      definirPreferencias: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as DefinirPreferenciasNotificacaoUseCase,
    });

    const res = await app.request(req(BODY_VALIDO));
    expect(res.status).toBe(403);
  });

  it('propaga AbortSignal ao use case (P-78)', async () => {
    const executar = vi.fn().mockResolvedValue({ usuarioId: 't', canais: ['EMAIL'], frequencia: 'DIARIA' });
    const app = buildApp({ definirPreferencias: { executar } as unknown as DefinirPreferenciasNotificacaoUseCase });

    await app.request(req(BODY_VALIDO));

    expect(executar).toHaveBeenCalledOnce();
    const [, signal] = executar.mock.calls[0]!;
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
