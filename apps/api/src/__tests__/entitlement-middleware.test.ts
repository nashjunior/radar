/**
 * Testes runtime do middleware `entitlement` (P-107 (3), RAD-246).
 *
 * Usa `ReservarCotaUseCase`/`LiberarReservaUseCase` reais sobre um
 * `AssinaturaRepository` fake em memória — exercita a integração completa
 * repositório → use case → middleware → resposta HTTP, sem duplo mock.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { TenantId } from '@radar/kernel';
import type { AssinaturaRepository } from '@radar/cobranca';
import { Assinatura, CicloDeFaturamento, LiberarReservaUseCase, PlanoComercial, ReservarCotaUseCase } from '@radar/cobranca';
import { criarEntitlementMiddleware } from '../middleware/entitlement.js';

const CICLO = CicloDeFaturamento.criar(new Date('2026-01-01'), new Date('2026-02-01'));

function planoCom(cota: number, codigo = 'starter'): PlanoComercial {
  return PlanoComercial.criar({ codigo, cotaTriagensMes: cota, precoCentavos: 12900 });
}

class FakeAssinaturaRepository implements AssinaturaRepository {
  private readonly porTenant = new Map<string, Assinatura>();
  liberacoes = 0;

  definir(tenantId: string, assinatura: Assinatura): void {
    this.porTenant.set(tenantId, assinatura);
  }

  async porTenantId(tenantId: TenantId, _signal: AbortSignal): Promise<Assinatura | null> {
    return this.porTenant.get(tenantId) ?? null;
  }

  /** Fora do escopo de RAD-246 (é RAD-250) — presente só para satisfazer a interface. */
  async porAssinaturaExternaId(assinaturaExternaId: string, _signal: AbortSignal): Promise<Assinatura | null> {
    for (const assinatura of this.porTenant.values()) {
      if (assinatura.assinaturaExternaId === assinaturaExternaId) return assinatura;
    }
    return null;
  }

  /** Fora do escopo de RAD-246 (é RAD-247) — presente só para satisfazer a interface. */
  async confirmarUso(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(
      tenantId,
      Assinatura.criar({
        ...atual,
        usoReservado: Math.max(atual.usoReservado - 1, 0),
        usoConfirmado: atual.usoConfirmado + 1,
      }),
    );
  }

  async salvar(assinatura: Assinatura, _signal: AbortSignal): Promise<void> {
    this.porTenant.set(assinatura.tenantId, assinatura);
  }

  async reservarCota(tenantId: TenantId, _signal: AbortSignal): Promise<boolean> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return false;
    if (atual.estado !== 'ativa' && atual.estado !== 'trial') return false;
    if (atual.usoReservado >= atual.plano.cota.valor) return false;
    this.porTenant.set(tenantId, Assinatura.criar({ ...atual, usoReservado: atual.usoReservado + 1 }));
    return true;
  }

  async liberarReserva(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    this.liberacoes += 1;
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(tenantId, Assinatura.criar({ ...atual, usoReservado: Math.max(atual.usoReservado - 1, 0) }));
  }
}

function buildApp(repo: FakeAssinaturaRepository, statusDownstream: number) {
  const app = new Hono();

  app.use('*', async (c: Context, next) => {
    c.set('tenantId', TenantId(c.req.header('x-test-tenant') ?? 'tenant-padrao'));
    await next();
  });

  const entitlement = criarEntitlementMiddleware({
    reservarCota: new ReservarCotaUseCase(repo),
    liberarReserva: new LiberarReservaUseCase(repo),
  });
  app.use('*', entitlement);

  app.post('/triagem/:editalId/solicitar', (c) => c.json({ ok: statusDownstream === 202 }, statusDownstream as never));

  return app;
}

function pedir(app: Hono, tenant: string) {
  return app.request('/triagem/e1/solicitar', {
    method: 'POST',
    headers: { 'x-test-tenant': tenant },
  });
}

describe('criarEntitlementMiddleware — 402 (P-107 (3))', () => {
  it('deixa passar (202) e incrementa usoReservado quando a cota comporta', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-ok');
    repo.definir(tenant, Assinatura.iniciarTrial(tenant, planoCom(5), CICLO).ativar('ext-1'));
    const app = buildApp(repo, 202);

    const res = await pedir(app, tenant);

    expect(res.status).toBe(202);
    expect((await repo.porTenantId(tenant, new AbortController().signal))?.usoReservado).toBe(1);
  });

  it('retorna 402 com { codigo, cota, usado, upgradeDisponivel } quando a cota está esgotada', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-sem-cota');
    const assinatura = Assinatura.iniciarTrial(tenant, planoCom(1, 'starter'), CICLO).ativar('ext-2');
    repo.definir(tenant, Assinatura.criar({ ...assinatura, usoReservado: 1 }));
    const app = buildApp(repo, 202);

    const res = await pedir(app, tenant);

    expect(res.status).toBe(402);
    const body = await res.json() as { codigo: string; cota: number; usado: number; upgradeDisponivel: boolean };
    expect(body).toEqual({ codigo: 'COTA_EXCEDIDA', cota: 1, usado: 1, upgradeDisponivel: true });
  });

  it('retorna 403 quando a assinatura está suspensa', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-suspenso');
    const suspensa = Assinatura.iniciarTrial(tenant, planoCom(5), CICLO).ativar('ext-3').marcarInadimplente().suspender();
    repo.definir(tenant, suspensa);
    const app = buildApp(repo, 202);

    const res = await pedir(app, tenant);

    expect(res.status).toBe(403);
    const body = await res.json() as { codigo: string };
    expect(body.codigo).toBe('ASSINATURA_INATIVA');
  });

  it('retorna 403 quando não há assinatura para o tenant', async () => {
    const repo = new FakeAssinaturaRepository();
    const app = buildApp(repo, 202);

    const res = await pedir(app, TenantId('tenant-nao-cadastrado'));

    expect(res.status).toBe(403);
  });
});

describe('criarEntitlementMiddleware — rollback da reserva na falha síncrona (P-107 (c))', () => {
  it('libera a reserva quando o handler downstream não retorna 202', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-rollback-404');
    repo.definir(tenant, Assinatura.iniciarTrial(tenant, planoCom(5), CICLO).ativar('ext-4'));
    const app = buildApp(repo, 404); // ex.: editalId/perfil não encontrado depois da reserva

    const res = await pedir(app, tenant);

    expect(res.status).toBe(404);
    expect(repo.liberacoes).toBe(1);
    expect((await repo.porTenantId(tenant, new AbortController().signal))?.usoReservado).toBe(0);
  });

  it('libera a reserva e propaga o erro quando o handler downstream lança', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-rollback-throw');
    repo.definir(tenant, Assinatura.iniciarTrial(tenant, planoCom(5), CICLO).ativar('ext-5'));

    const app = new Hono();
    app.use('*', async (c: Context, next) => {
      c.set('tenantId', TenantId(c.req.header('x-test-tenant') ?? 'tenant-padrao'));
      await next();
    });
    const entitlement = criarEntitlementMiddleware({
      reservarCota: new ReservarCotaUseCase(repo),
      liberarReserva: new LiberarReservaUseCase(repo),
    });
    app.use('*', entitlement);
    app.post('/triagem/:editalId/solicitar', () => {
      throw new Error('publish de triagem.solicitada falhou');
    });
    app.onError((err, c) => c.json({ code: 'ERRO_INTERNO', mensagem: String(err) }, 500));

    const res = await pedir(app, tenant);

    expect(res.status).toBe(500);
    expect(repo.liberacoes).toBe(1);
    expect((await repo.porTenantId(tenant, new AbortController().signal))?.usoReservado).toBe(0);
  });

  it('não libera a reserva quando o handler retorna 202 (sucesso)', async () => {
    const repo = new FakeAssinaturaRepository();
    const tenant = TenantId('tenant-sucesso');
    repo.definir(tenant, Assinatura.iniciarTrial(tenant, planoCom(5), CICLO).ativar('ext-6'));
    const app = buildApp(repo, 202);

    await pedir(app, tenant);

    expect(repo.liberacoes).toBe(0);
  });
});
