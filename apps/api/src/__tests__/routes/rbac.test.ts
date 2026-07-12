/**
 * Teste de integração por rota — matriz AB2 (RBAC/P-52, docs/05 §4, RAD-212).
 *
 * Diferente dos demais testes de rota (que dão bypass ao RBAC com um
 * `autorizar` sempre-permite), este arquivo monta a cadeia REAL:
 * `ResolverContextoAutorizacaoUseCase` + `AutorizarAcessoUseCase` +
 * `criarAutorizarMiddlewareFactory`, contra um `PermissaoRepository` fake
 * (in-memory) com 3 usuários fixos — um por papel operacional. A verificação
 * de JWT (AB3) é dublada por um `autenticarMiddleware` fake que só projeta
 * tenantId/usuarioId de headers de teste — já coberta em tenant-middleware.test.ts.
 *
 * Prova (por rota, nas 5 áreas + GET /api/me):
 *   - operador não vira admin / read-only não escreve (403 PAPEL_NAO_AUTORIZADO)
 *   - token válido sem papel nega (sem atribuição no PermissaoRepository)
 *   - papéis com a ação permitida passam (o use case por trás é mockado)
 *
 * "papel em um clienteFinalId não alcança outro" e "AUDIT_LOG/SOLICITACAO_TITULAR
 * restritos" são provados no nível de use case, mesmo padrão dos demais gates
 * AB* — ver tests/security/src/ab-gates.test.ts e
 * modules/identidade/src/__tests__/application/autorizar-acesso.test.ts — porque
 * a rota HTTP de hoje não tem `clienteFinalId` na assinatura de `autorizar()`
 * (2 argumentos: recurso, ação) nem rotas para USUARIO_PAPEL/AUDIT_LOG/SOLICITACAO_TITULAR.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { Context, MiddlewareHandler } from 'hono';
import {
  AtribuicaoPapel,
  AutorizarAcessoUseCase,
  ResolverContextoAutorizacaoUseCase,
  UsuarioId,
} from '@radar/identidade';
import type { PermissaoRepository } from '@radar/identidade';

const TENANT = TenantId('tenant-1');
const CLIENTE = ClienteFinalId('cliente-1');
const PERFIL = PerfilId('perfil-1');

const USUARIO_ADMIN = UsuarioId('usuario-admin');
const USUARIO_OPERADOR = UsuarioId('usuario-operador');
const USUARIO_READONLY = UsuarioId('usuario-readonly');
const USUARIO_SEM_PAPEL = UsuarioId('usuario-sem-papel');

vi.mock('../../middleware/tenant.js', () => ({
  autenticarMiddleware: (async (c: Context, next: () => Promise<void>) => {
    c.set('tenantId', TenantId('tenant-1'));
    const usuarioIdHeader = c.req.header('x-test-usuario-id');
    if (usuarioIdHeader) c.set('usuarioId', UsuarioId(usuarioIdHeader));
    return next();
  }) satisfies MiddlewareHandler,
}));

vi.mock('../../security.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../security.js')>()),
  rateLimitPorTenantMiddleware: (async (_c: Context, next: () => Promise<void>) => next()) satisfies MiddlewareHandler,
}));

import { criarAutorizarMiddlewareFactory } from '../../middleware/autorizacao.js';
import { criarAlertasRouter } from '../../routes/alertas.js';
import { criarMatchingRouter } from '../../routes/matching.js';
import { criarTriagemRouter } from '../../routes/triagem.js';
import { criarIdentidadeRouter } from '../../routes/identidade.js';
import { criarNotificacaoRouter } from '../../routes/notificacao.js';
import { criarMeRouter } from '../../routes/me.js';

function permissaoRepositoryFake(atribuicoes: readonly AtribuicaoPapel[]): PermissaoRepository {
  const mapa = new Map(atribuicoes.map((a) => [a.usuarioId as string, a]));
  return {
    async buscarPorUsuario(usuarioId, opts) {
      opts.signal.throwIfAborted();
      return mapa.get(usuarioId) ?? null;
    },
  };
}

const permissoes = permissaoRepositoryFake([
  AtribuicaoPapel.criar({ usuarioId: USUARIO_ADMIN, tenantId: TENANT, papel: 'ADMIN_CONSULTORIA', clienteFinalIds: [CLIENTE, ClienteFinalId('cliente-2')] }),
  AtribuicaoPapel.criar({ usuarioId: USUARIO_OPERADOR, tenantId: TENANT, papel: 'OPERADOR', clienteFinalIds: [CLIENTE] }),
  AtribuicaoPapel.criar({ usuarioId: USUARIO_READONLY, tenantId: TENANT, papel: 'CLIENTE_FINAL_READONLY', clienteFinalIds: [CLIENTE] }),
]);

const resolverContexto = new ResolverContextoAutorizacaoUseCase(permissoes);
const autorizarAcesso = new AutorizarAcessoUseCase();
const autorizar = criarAutorizarMiddlewareFactory({ resolverContexto, autorizarAcesso });

function headerDe(usuarioId: string | undefined): Record<string, string> {
  return usuarioId ? { 'x-test-usuario-id': usuarioId } : {};
}

function buildApp(): Hono {
  const app = new Hono();

  app.route('/api/me', criarMeRouter({ resolverContexto }));

  app.route('/api/alertas', criarAlertasRouter({
    consultarAlertas: { executar: vi.fn().mockResolvedValue([]) } as never,
    autorizar,
  }));

  const perfilAtivoOk = { resolverParaTenant: vi.fn().mockResolvedValue({ clienteFinalId: CLIENTE, perfilId: PERFIL }) };

  app.route('/api/matching', criarMatchingRouter({
    definirCriterio: { executar: vi.fn().mockResolvedValue({ id: 'crit-1', tenantId: TENANT, clienteFinalId: CLIENTE, palavrasChave: [], ativo: true }) } as never,
    consultarCriterios: { executar: vi.fn().mockResolvedValue([]) } as never,
    registrarFeedback: { executar: vi.fn().mockResolvedValue(undefined) } as never,
    consultarMetricas: { executar: vi.fn().mockResolvedValue({ precisao: 0.7, precisaoAlvo: 0.6, ativacao: 0.5, ativacaoAlvo: 0.5, janelaEmDias: 7 }) } as never,
    perfilAtivo: perfilAtivoOk,
    autorizar,
  }));

  app.route('/api/triagem', criarTriagemRouter({
    consultarTriagem: { executar: vi.fn().mockResolvedValue({ status: 'processando' }) } as never,
    solicitarTriagem: { executar: vi.fn().mockResolvedValue(undefined) } as never,
    registrarFeedback: { executar: vi.fn().mockResolvedValue(undefined) } as never,
    perfilAtivo: perfilAtivoOk,
    autorizar,
    // Gate de cota (P-107 (3)) real é coberto em entitlement-middleware.test.ts — aqui sempre-permite
    entitlement: (async (_c: Context, next: () => Promise<void>) => next()) as MiddlewareHandler,
  }));

  app.route('/api/identidade', criarIdentidadeRouter({
    consultarPerfil: { executar: vi.fn().mockResolvedValue({ id: 'perfil-1', clienteFinalId: CLIENTE, habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] }) } as never,
    gerenciarPerfil: { executar: vi.fn().mockResolvedValue({ id: 'perfil-1', clienteFinalId: CLIENTE, habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] }) } as never,
    perfilAtivo: perfilAtivoOk,
    autorizar,
  }));

  app.route('/api/notificacao', criarNotificacaoRouter({
    definirPreferencias: { executar: vi.fn().mockResolvedValue({ usuarioId: 'u', canais: ['EMAIL'], frequencia: 'DIARIA' }) } as never,
    autorizar,
  }));

  return app;
}

const PERFIL_PUT_BODY = { habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] };
const PREFERENCIAS_BODY = { canais: ['EMAIL'], frequencia: 'DIARIA' };

describe('RBAC (AB2) — GET /api/alertas: ALERTA ler', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/alertas', { headers: headerDe(usuarioId) });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — POST /api/matching/criterios: CRITERIO_MONITORAMENTO criar', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 201],
    ['OPERADOR', USUARIO_OPERADOR, 201],
    ['CLIENTE_FINAL_READONLY (read-only não escreve)', USUARIO_READONLY, 403],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/matching/criterios', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headerDe(usuarioId) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — GET /api/matching/criterios: CRITERIO_MONITORAMENTO ler', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/matching/criterios', { headers: headerDe(usuarioId) });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — PATCH /api/matching/alertas/:id/feedback: ALERTA decidir', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 204],
    ['OPERADOR', USUARIO_OPERADOR, 204],
    ['CLIENTE_FINAL_READONLY (read-only não decide)', USUARIO_READONLY, 403],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/matching/alertas/alerta-1/feedback', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...headerDe(usuarioId) },
      body: JSON.stringify({ relevante: true }),
    });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — GET /api/matching/metricas: ALERTA ler', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/matching/metricas', { headers: headerDe(usuarioId) });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — GET /api/triagem/:editalId: TRIAGEM ler', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/triagem/edital-1', { headers: headerDe(usuarioId) });
    expect(res.status).toBe(status);
  });
});

describe.each([
  ['/api/triagem/edital-1/solicitar', 'TRIAGEM criar'],
  ['/api/triagem/edital-1/aceitar', 'TRIAGEM decidir'],
  ['/api/triagem/edital-1/contestar', 'TRIAGEM decidir'],
  ['/api/triagem/edital-1/decisao', 'TRIAGEM decidir'],
])('RBAC (AB2) — POST %s: %s', (path) => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 202],
    ['OPERADOR', USUARIO_OPERADOR, 202],
    ['CLIENTE_FINAL_READONLY (read-only não escreve)', USUARIO_READONLY, 403],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headerDe(usuarioId) },
      body: JSON.stringify(path.endsWith('decisao') ? { go: true } : {}),
    });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — GET /api/identidade/perfil: PERFIL_HABILITACAO ler', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/identidade/perfil', { headers: headerDe(usuarioId) });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — PUT /api/identidade/perfil: PERFIL_HABILITACAO editar', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY (read-only não escreve)', USUARIO_READONLY, 403],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/identidade/perfil', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headerDe(usuarioId) },
      body: JSON.stringify(PERFIL_PUT_BODY),
    });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — PUT /api/notificacao/preferencias: PREFERENCIA_NOTIFICACAO editar', () => {
  it.each([
    ['ADMIN_CONSULTORIA', USUARIO_ADMIN, 200],
    ['OPERADOR', USUARIO_OPERADOR, 200],
    ['CLIENTE_FINAL_READONLY (ajusta as próprias)', USUARIO_READONLY, 200],
    ['sem papel', USUARIO_SEM_PAPEL, 403],
  ] as const)('%s', async (_papel, usuarioId, status) => {
    const app = buildApp();
    const res = await app.request('/api/notificacao/preferencias', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headerDe(usuarioId) },
      body: JSON.stringify(PREFERENCIAS_BODY),
    });
    expect(res.status).toBe(status);
  });
});

describe('RBAC (AB2) — negação carrega code PAPEL_NAO_AUTORIZADO (distinto do ACESSO_NEGADO de AB1)', () => {
  it('403 com code PAPEL_NAO_AUTORIZADO quando read-only tenta escrever', async () => {
    const app = buildApp();
    const res = await app.request('/api/matching/criterios', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headerDe(USUARIO_READONLY) },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PAPEL_NAO_AUTORIZADO');
  });

  it('403 com code PAPEL_NAO_AUTORIZADO quando token válido não tem papel atribuído', async () => {
    const app = buildApp();
    const res = await app.request('/api/alertas', { headers: headerDe(USUARIO_SEM_PAPEL) });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PAPEL_NAO_AUTORIZADO');
  });
});

describe('GET /api/me — ContextoAutorizacaoDTO (docs/14 §6)', () => {
  it('200 com { usuarioId, tenantId, papel, clienteFinalIds } quando há atribuição', async () => {
    const app = buildApp();
    const res = await app.request('/api/me', { headers: headerDe(USUARIO_OPERADOR) });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      usuarioId: string; tenantId: string; papel: string; clienteFinalIds: string[];
    };
    expect(body.usuarioId).toBe(USUARIO_OPERADOR);
    expect(body.tenantId).toBe(TENANT);
    expect(body.papel).toBe('OPERADOR');
    expect(body.clienteFinalIds).toEqual([CLIENTE]);
  });

  it('403 PAPEL_NAO_AUTORIZADO quando o usuário autenticado não tem atribuição', async () => {
    const app = buildApp();
    const res = await app.request('/api/me', { headers: headerDe(USUARIO_SEM_PAPEL) });

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PAPEL_NAO_AUTORIZADO');
  });
});
