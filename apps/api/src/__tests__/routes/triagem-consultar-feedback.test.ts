/**
 * Testes unitários: GET /api/triagem/:editalId e rotas de feedback (RAD-81)
 *
 * Cobre:
 *   GET /:editalId — 200 status simples, 200 concluida c/ payload completo,
 *     404 quando resultado null, 404 sem perfil ativo, 403 AcessoNegadoError,
 *     P-51 (clienteFinalId/perfilId do perfilAtivo).
 *   POST /:editalId/aceitar — 202 happy path, 404 sem perfil, 403 AcessoNegadoError.
 *   POST /:editalId/contestar — 202 com/sem motivo, tipo='contestada' passado ao UC.
 *   POST /:editalId/decisao — 202 go=true, 202 go=false, 400 campo go ausente.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AcessoNegadoError, ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';

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
const BASE = 'http://localhost/api/triagem';

const PERFIL = { perfilId: PerfilId('perfil-1'), clienteFinalId: ClienteFinalId('cliente-1') };

const RESULTADO_PROCESSANDO = { status: 'processando' as const };

const RESULTADO_CONCLUIDA = {
  status: 'concluida' as const,
  editalId: EDITAL,
  perfilId: 'perfil-1',
  aderencia: 0.82,
  recomendacao: 'go' as const,
  confiancaIA: 0.9,
  paginasEdital: 12,
  camposAnalise: [{ titulo: 'Objeto', conteudo: 'TI', fonte: 'edital', estado: 'ok' as const }],
  checklist: [{ ok: true, texto: 'Habilitação fiscal' }],
};

// RBAC (P-52) real é coberto em rbac.test.ts — aqui o gate é sempre-permite (bypassed)
const autorizarPermissivo: TriagemContainer['autorizar'] =
  () => (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler;

function buildApp(overrides?: Partial<TriagemContainer>): Hono {
  const container: TriagemContainer = {
    consultarTriagem: {
      executar: vi.fn().mockResolvedValue(null),
    } as unknown as ConsultarTriagemUseCase,
    solicitarTriagem: {
      executar: vi.fn().mockResolvedValue(undefined),
    } as unknown as SolicitarTriagemUseCase,
    registrarFeedback: {
      executar: vi.fn().mockResolvedValue(undefined),
    } as unknown as RegistrarFeedbackTriagemUseCase,
    perfilAtivo: {
      resolverParaTenant: vi.fn().mockResolvedValue(PERFIL),
    },
    autorizar: autorizarPermissivo,
    ...overrides,
  };

  const app = new Hono();
  app.route('/api/triagem', criarTriagemRouter(container));
  return app;
}

// ─────────────────────────────────────────────
// GET /api/triagem/:editalId
// ─────────────────────────────────────────────
describe('GET /api/triagem/:editalId', () => {
  it('200 + { status: processando } quando triagem está em andamento', async () => {
    const app = buildApp({
      consultarTriagem: {
        executar: vi.fn().mockResolvedValue(RESULTADO_PROCESSANDO),
      } as unknown as ConsultarTriagemUseCase,
    });

    const res = await app.request(`${BASE}/${EDITAL}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('processando');
  });

  it('200 + payload completo quando triagem está concluída', async () => {
    const app = buildApp({
      consultarTriagem: {
        executar: vi.fn().mockResolvedValue(RESULTADO_CONCLUIDA),
      } as unknown as ConsultarTriagemUseCase,
    });

    const res = await app.request(`${BASE}/${EDITAL}`);

    expect(res.status).toBe(200);
    const body = await res.json() as typeof RESULTADO_CONCLUIDA;
    expect(body.status).toBe('concluida');
    expect(body.aderencia).toBe(0.82);
    expect(body.recomendacao).toBe('go');
    expect(body.camposAnalise).toHaveLength(1);
    expect(body.checklist).toHaveLength(1);
  });

  it('404 quando consultar retorna null (triagem nunca solicitada)', async () => {
    const app = buildApp();  // consultarTriagem returns null by default

    const res = await app.request(`${BASE}/${EDITAL}`);

    expect(res.status).toBe(404);
  });

  it('404 quando perfilAtivo retorna null (tenant desconhecido)', async () => {
    const app = buildApp({
      perfilAtivo: { resolverParaTenant: vi.fn().mockResolvedValue(null) },
    });

    const res = await app.request(`${BASE}/${EDITAL}`);

    expect(res.status).toBe(404);
  });

  it('403 quando use case lança AcessoNegadoError (authz por objeto P-51)', async () => {
    const app = buildApp({
      consultarTriagem: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as ConsultarTriagemUseCase,
    });

    const res = await app.request(`${BASE}/${EDITAL}`);

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ACESSO_NEGADO');
  });

  it('P-51: perfilId e clienteFinalId do perfilAtivo são passados ao use case (não da URL)', async () => {
    const executar = vi.fn().mockResolvedValue(null);
    const app = buildApp({
      consultarTriagem: { executar } as unknown as ConsultarTriagemUseCase,
    });

    await app.request(`${BASE}/${EDITAL}`);

    const [input] = executar.mock.calls[0] as [{ perfilId: string; clienteFinalId: string }];
    expect(input.perfilId).toBe(PERFIL.perfilId);
    expect(input.clienteFinalId).toBe(PERFIL.clienteFinalId);
  });
});

// ─────────────────────────────────────────────
// POST /api/triagem/:editalId/aceitar
// ─────────────────────────────────────────────
describe('POST /api/triagem/:editalId/aceitar', () => {
  it('202 + { ok: true } no happy path', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/aceitar`, { method: 'POST' });

    expect(res.status).toBe(202);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('registra tipo="aceita" no use case', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      registrarFeedback: { executar } as unknown as RegistrarFeedbackTriagemUseCase,
    });

    await app.request(`${BASE}/${EDITAL}/aceitar`, { method: 'POST' });

    const [input] = executar.mock.calls[0] as [{ tipo: string }];
    expect(input.tipo).toBe('aceita');
  });

  it('404 quando perfilAtivo retorna null', async () => {
    const app = buildApp({
      perfilAtivo: { resolverParaTenant: vi.fn().mockResolvedValue(null) },
    });

    const res = await app.request(`${BASE}/${EDITAL}/aceitar`, { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('403 quando use case lança AcessoNegadoError', async () => {
    const app = buildApp({
      registrarFeedback: {
        executar: vi.fn().mockRejectedValue(new AcessoNegadoError()),
      } as unknown as RegistrarFeedbackTriagemUseCase,
    });

    const res = await app.request(`${BASE}/${EDITAL}/aceitar`, { method: 'POST' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────
// POST /api/triagem/:editalId/contestar
// ─────────────────────────────────────────────
describe('POST /api/triagem/:editalId/contestar', () => {
  it('202 com motivo fornecido', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Objeto incorreto.' }),
    });

    expect(res.status).toBe(202);
  });

  it('202 sem motivo (motivo null aceito)', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: null }),
    });

    expect(res.status).toBe(202);
  });

  it('202 sem campo motivo', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(202);
  });

  it('registra tipo="contestada" e motivo ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      registrarFeedback: { executar } as unknown as RegistrarFeedbackTriagemUseCase,
    });

    await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Não é nosso segmento.' }),
    });

    const [input] = executar.mock.calls[0] as [{ tipo: string; motivo: string | null }];
    expect(input.tipo).toBe('contestada');
    expect(input.motivo).toBe('Não é nosso segmento.');
  });

  it('passa motivo=null quando campo ausente', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      registrarFeedback: { executar } as unknown as RegistrarFeedbackTriagemUseCase,
    });

    await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const [input] = executar.mock.calls[0] as [{ motivo: string | null }];
    expect(input.motivo).toBeNull();
  });

  it('400 quando contestação traz campo extra fora do schema', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/contestar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Não atende.', clienteFinalId: 'cliente-injetado' }),
    });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
// POST /api/triagem/:editalId/decisao
// ─────────────────────────────────────────────
describe('POST /api/triagem/:editalId/decisao', () => {
  it('202 + { ok: true } quando go=true', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go: true }),
    });

    expect(res.status).toBe(202);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('202 quando go=false (no-go registrado)', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go: false }),
    });

    expect(res.status).toBe(202);
  });

  it('400 quando campo "go" está ausente', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outro: 'campo' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CORPO_INVALIDO');
  });

  it('400 quando corpo não é JSON válido', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'não-é-json',
    });

    expect(res.status).toBe(400);
  });

  it('400 quando decisão traz campo extra fora do schema', async () => {
    const app = buildApp();

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go: true, tenantId: 'tenant-injetado' }),
    });

    expect(res.status).toBe(400);
  });

  it('registra tipo="decisao" e go ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      registrarFeedback: { executar } as unknown as RegistrarFeedbackTriagemUseCase,
    });

    await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go: true }),
    });

    const [input] = executar.mock.calls[0] as [{ tipo: string; go: boolean }];
    expect(input.tipo).toBe('decisao');
    expect(input.go).toBe(true);
  });

  it('404 quando perfilAtivo retorna null', async () => {
    const app = buildApp({
      perfilAtivo: { resolverParaTenant: vi.fn().mockResolvedValue(null) },
    });

    const res = await app.request(`${BASE}/${EDITAL}/decisao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go: true }),
    });

    expect(res.status).toBe(404);
  });
});
