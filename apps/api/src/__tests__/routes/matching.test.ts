/**
 * Testes unitários: POST /api/matching/criterios, GET /api/matching/metricas,
 * PATCH /api/matching/alertas/:alertaId/feedback
 *
 * Cobre:
 *   POST /criterios — 201 happy path, 400 corpo inválido, 404 sem perfil ativo,
 *     403 AcessoNegadoError, P-51 clienteFinalId sempre do perfilAtivo.
 *   PATCH /alertas/:id/feedback — 204 happy path, 400 corpo inválido,
 *     404 sem perfil ativo, 403 AcessoNegadoError, 404 AlertaNaoEncontradoError.
 *   GET /metricas — 200 happy path, 400 janelaEmDias inválida, passa tenantId ao UC.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AcessoNegadoError, ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import { AlertaNaoEncontradoError } from '@radar/matching';

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

import { criarMatchingRouter } from '../../routes/matching.js';
import type { MatchingContainer } from '../../routes/matching.js';
import type {
  ConsultarMetricasMatchingUseCase,
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import type { PerfilAtivoGateway } from '../../ports/perfil-ativo-gateway.js';

const TENANT = TenantId('tenant-1');
const CLIENTE = ClienteFinalId('cliente-1');
const PERFIL_ID = PerfilId('perfil-1');

const CRITERIO_DTO = {
  id: 'crit-1',
  tenantId: TENANT,
  clienteFinalId: CLIENTE,
  ramoCnae: null,
  regiaoUf: 'SP',
  faixaValorMin: null,
  faixaValorMax: null,
  palavrasChave: ['ti'],
  ativo: true,
};

const METRICAS_DTO = {
  precisao: 0.7,
  precisaoAlvo: 0.6,
  ativacao: 0.5,
  ativacaoAlvo: 0.5,
  janelaEmDias: 30,
};

const perfilAtivoOk: PerfilAtivoGateway = {
  resolverParaTenant: vi.fn().mockResolvedValue({ clienteFinalId: CLIENTE, perfilId: PERFIL_ID }),
};

const perfilAtivoNulo: PerfilAtivoGateway = {
  resolverParaTenant: vi.fn().mockResolvedValue(null),
};

// RBAC (P-52) real é coberto em rbac.test.ts — aqui o gate é sempre-permite (bypassed)
const autorizarPermissivo: MatchingContainer['autorizar'] =
  () => (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildApp(overrides?: Partial<MatchingContainer>): Hono {
  const container: MatchingContainer = {
    definirCriterio: {
      executar: vi.fn().mockResolvedValue(CRITERIO_DTO),
    } as unknown as DefinirCriterioMonitoramentoUseCase,
    registrarFeedback: {
      executar: vi.fn().mockResolvedValue(undefined),
    } as unknown as RegistrarFeedbackAlertaUseCase,
    consultarMetricas: {
      executar: vi.fn().mockResolvedValue(METRICAS_DTO),
    } as unknown as ConsultarMetricasMatchingUseCase,
    perfilAtivo: perfilAtivoOk,
    autorizar: autorizarPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/matching', criarMatchingRouter(container));
  return app;
}

const BASE = 'http://localhost/api/matching';

// ─────────────────────────────────────────────
// POST /api/matching/criterios
// ─────────────────────────────────────────────
describe('POST /api/matching/criterios', () => {
  it('201 + CriterioDTO no happy path', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regiaoUf: 'SP', palavrasChave: ['ti'] }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json() as typeof CRITERIO_DTO;
    expect(body.id).toBe('crit-1');
    expect(body.regiaoUf).toBe('SP');
  });

  it('400 quando corpo não é JSON válido', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'não-é-json',
      }),
    );

    expect(res.status).toBe(400);
  });

  it('400 quando corpo tenta mass assignment com campo fora do schema', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regiaoUf: 'SP', clienteFinalId: 'outro-cliente' }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('404 quando perfilAtivo retorna null (sem perfil ativo)', async () => {
    const app = buildApp({ perfilAtivo: perfilAtivoNulo });
    const res = await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('403 quando use case lança AcessoNegadoError (P-51)', async () => {
    const app = buildApp({
      definirCriterio: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as DefinirCriterioMonitoramentoUseCase,
    });

    const res = await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ACESSO_NEGADO');
  });

  it('clienteFinalId vem do perfilAtivo em input válido (P-51 IDOR)', async () => {
    const executar = vi.fn().mockResolvedValue(CRITERIO_DTO);
    const app = buildApp({
      definirCriterio: { executar } as unknown as DefinirCriterioMonitoramentoUseCase,
    });

    await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regiaoUf: 'SP' }),
      }),
    );

    const [input] = executar.mock.calls[0] as [{ clienteFinalId: string }];
    expect(input.clienteFinalId).toBe(CLIENTE);
  });

  it('tenantId do JWT é passado ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(CRITERIO_DTO);
    const app = buildApp({
      definirCriterio: { executar } as unknown as DefinirCriterioMonitoramentoUseCase,
    });

    await app.request(
      new Request(`${BASE}/criterios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    const [input] = executar.mock.calls[0] as [{ tenantId: string }];
    expect(input.tenantId).toBe(TENANT);
  });
});

// ─────────────────────────────────────────────
// PATCH /api/matching/alertas/:alertaId/feedback
// ─────────────────────────────────────────────
describe('PATCH /api/matching/alertas/:alertaId/feedback', () => {
  const FEEDBACK_URL = `${BASE}/alertas/alerta-001/feedback`;

  it('204 no happy path', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: true }),
      }),
    );

    expect(res.status).toBe(204);
  });

  it('400 quando "relevante" está ausente do corpo', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outroCampo: 123 }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('BODY_INVALIDO');
  });

  it('400 quando o corpo não é JSON válido', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'não-é-json',
      }),
    );

    expect(res.status).toBe(400);
  });

  it('400 quando feedback traz campo extra fora do schema', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: true, tenantId: 'tenant-injetado' }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('404 quando perfilAtivo retorna null', async () => {
    const app = buildApp({ perfilAtivo: perfilAtivoNulo });
    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: false }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('403 quando use case lança AcessoNegadoError (authz por objeto P-51/AB1)', async () => {
    const app = buildApp({
      registrarFeedback: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as RegistrarFeedbackAlertaUseCase,
    });

    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: true }),
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ACESSO_NEGADO');
  });

  it('404 quando use case lança AlertaNaoEncontradoError', async () => {
    const app = buildApp({
      registrarFeedback: {
        executar: vi.fn().mockRejectedValue(new AlertaNaoEncontradoError('alerta-001')),
      } as unknown as RegistrarFeedbackAlertaUseCase,
    });

    const res = await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: true }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('clienteFinalId vem do perfilAtivo, não da URL (P-51 IDOR)', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      registrarFeedback: { executar } as unknown as RegistrarFeedbackAlertaUseCase,
    });

    await app.request(
      new Request(FEEDBACK_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relevante: true }),
      }),
    );

    const [input] = executar.mock.calls[0] as [{ clienteFinalId: string; alertaId: string }];
    expect(input.clienteFinalId).toBe(CLIENTE);
    expect(input.alertaId).toBe('alerta-001');
  });
});

// ─────────────────────────────────────────────
// GET /api/matching/metricas
// ─────────────────────────────────────────────
describe('GET /api/matching/metricas', () => {
  it('200 + MetricasMatchingDTO no happy path', async () => {
    const app = buildApp();
    const res = await app.request(new Request(`${BASE}/metricas`));

    expect(res.status).toBe(200);
    const body = await res.json() as typeof METRICAS_DTO;
    expect(body.precisao).toBe(0.7);
    expect(body.janelaEmDias).toBe(30);
  });

  it('tenantId do JWT é passado ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(METRICAS_DTO);
    const app = buildApp({
      consultarMetricas: { executar } as unknown as ConsultarMetricasMatchingUseCase,
    });

    await app.request(new Request(`${BASE}/metricas`));

    const [input] = executar.mock.calls[0] as [{ tenantId: string }];
    expect(input.tenantId).toBe(TENANT);
  });

  it('400 quando janelaEmDias não é inteiro positivo', async () => {
    const app = buildApp();
    const res = await app.request(new Request(`${BASE}/metricas?janelaEmDias=0`));

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PARAMETRO_INVALIDO');
  });

  it('400 quando janelaEmDias é negativo', async () => {
    const app = buildApp();
    const res = await app.request(new Request(`${BASE}/metricas?janelaEmDias=-5`));

    expect(res.status).toBe(400);
  });

  it('400 quando janelaEmDias é decimal', async () => {
    const app = buildApp();
    const res = await app.request(new Request(`${BASE}/metricas?janelaEmDias=1.5`));

    expect(res.status).toBe(400);
  });

  it('200 passando janelaEmDias válida ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(METRICAS_DTO);
    const app = buildApp({
      consultarMetricas: { executar } as unknown as ConsultarMetricasMatchingUseCase,
    });

    const res = await app.request(new Request(`${BASE}/metricas?janelaEmDias=7`));

    expect(res.status).toBe(200);
    const [input] = executar.mock.calls[0] as [{ janelaEmDias?: number }];
    expect(input.janelaEmDias).toBe(7);
  });
});
