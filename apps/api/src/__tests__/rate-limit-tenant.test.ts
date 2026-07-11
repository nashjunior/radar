/**
 * Testes runtime do rateLimitPorTenantMiddleware (P-55, RAD-209).
 *
 * Cobre: teto por janela, 429 + Retry-After, reset após expirar a janela e —
 * o ponto central da issue — isolamento entre tenants: um tenant estourando
 * o teto não pode afetar outro tenant no mesmo processo (senão vira
 * rate-limit global disfarçado de rate-limit por tenant).
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { TenantId } from '@radar/kernel';
import { criarRateLimitPorTenantMiddleware } from '../security.js';

function buildApp(teto: number, janelaMs: number, relogio: { agora: number }) {
  const app = new Hono();

  // Stub do que o autenticarMiddleware faria de verdade — deriva tenantId de
  // um header de teste, nunca do próprio rate-limit (cobertura do JWT real
  // fica em tenant-middleware.test.ts).
  app.use('*', async (c: Context, next) => {
    c.set('tenantId', TenantId(c.req.header('x-test-tenant') ?? 'tenant-padrao'));
    await next();
  });

  app.use('*', criarRateLimitPorTenantMiddleware({
    janelaMs,
    tetoPorTask: teto,
    agoraMs: () => relogio.agora,
  }));

  app.get('/recurso', (c) => c.json({ ok: true }));
  return app;
}

async function pedir(app: Hono, tenant: string) {
  return app.request('/recurso', { headers: { 'x-test-tenant': tenant } });
}

describe('rateLimitPorTenantMiddleware (P-55, RAD-209)', () => {
  it('permite requisições até o teto e bloqueia a próxima com 429 + Retry-After', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(3, 60_000, relogio);

    for (let i = 0; i < 3; i++) {
      const res = await pedir(app, 'tenant-a');
      expect(res.status).toBe(200);
    }

    const bloqueado = await pedir(app, 'tenant-a');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get('retry-after')).toBe('60');

    const body = await bloqueado.json() as { code: string; mensagem: string };
    expect(body.code).toBe('LIMITE_REQUISICOES_EXCEDIDO');
    expect(body.mensagem).not.toContain('tenant-a');
  });

  it('isola tenants — um estourando o teto não afeta o outro', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(2, 60_000, relogio);

    // tenant-a esgota o teto e passa a ser bloqueado.
    await pedir(app, 'tenant-a');
    await pedir(app, 'tenant-a');
    const aBloqueado = await pedir(app, 'tenant-a');
    expect(aBloqueado.status).toBe(429);

    // tenant-b segue livre no mesmo processo, mesma janela — se isto falhar,
    // o "rate-limit por tenant" na verdade é um rate-limit global.
    const bPrimeira = await pedir(app, 'tenant-b');
    const bSegunda = await pedir(app, 'tenant-b');
    expect(bPrimeira.status).toBe(200);
    expect(bSegunda.status).toBe(200);

    // tenant-a continua bloqueado dentro da mesma janela — b não "emprestou" cota.
    const aAindaBloqueado = await pedir(app, 'tenant-a');
    expect(aAindaBloqueado.status).toBe(429);
  });

  it('reseta o teto quando a janela expira', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(1, 1_000, relogio);

    expect((await pedir(app, 'tenant-a')).status).toBe(200);
    expect((await pedir(app, 'tenant-a')).status).toBe(429);

    relogio.agora = 1_000;
    expect((await pedir(app, 'tenant-a')).status).toBe(200);
  });
});

describe('rateLimitPorTenantMiddleware — stress adversarial (P-55, RAD-221)', () => {
  it('tetoPorTask = 0 bloqueia a primeira requisição (zero-allowance sentinel)', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(0, 60_000, relogio);

    const res = await pedir(app, 'tenant-zero');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('50 tenants distintos, 1 req cada — nenhum é bloqueado (isolamento em escala)', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(1, 60_000, relogio);

    const resultados = await Promise.all(
      Array.from({ length: 50 }, (_, i) => pedir(app, `tenant-${i}`)),
    );
    for (const res of resultados) {
      expect(res.status).toBe(200);
    }
  });

  it('50 tenants distintos, cada um esgotando o teto — não vazam cota entre si', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(2, 60_000, relogio);

    for (let t = 0; t < 50; t++) {
      const tenant = `tenant-cota-${t}`;
      await pedir(app, tenant); // 1ª — permitida
      await pedir(app, tenant); // 2ª — permitida (= teto)
      const bloqueado = await pedir(app, tenant); // 3ª — bloqueada
      expect(bloqueado.status).toBe(429);
    }

    // Após esgotar os 50 tenants, um novo tenant ainda tem cota intacta
    const novoTenant = await pedir(app, 'tenant-novo-apos-tudo');
    expect(novoTenant.status).toBe(200);
  });

  it('Retry-After reflete o tempo restante da janela, não a duração total', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(1, 60_000, relogio);

    // Esgota o teto no início da janela
    await pedir(app, 'tenant-r');
    const bloqueado1 = await pedir(app, 'tenant-r');
    expect(bloqueado1.headers.get('retry-after')).toBe('60'); // janela inteira restando

    // Avança 45 segundos na mesma janela
    relogio.agora = 45_000;
    const bloqueado2 = await pedir(app, 'tenant-r');
    expect(bloqueado2.headers.get('retry-after')).toBe('15'); // 60s - 45s = 15s restando
  });

  it('janelas sucessivas são independentes — 3 janelas, cada uma com teto 2', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(2, 1_000, relogio);

    // Janela 0: 2 permitidas, 3ª bloqueada
    expect((await pedir(app, 'tenant-janelas')).status).toBe(200);
    expect((await pedir(app, 'tenant-janelas')).status).toBe(200);
    expect((await pedir(app, 'tenant-janelas')).status).toBe(429);

    // Janela 1: reset, 2 permitidas novamente
    relogio.agora = 1_000;
    expect((await pedir(app, 'tenant-janelas')).status).toBe(200);
    expect((await pedir(app, 'tenant-janelas')).status).toBe(200);
    expect((await pedir(app, 'tenant-janelas')).status).toBe(429);

    // Janela 2: reset novamente
    relogio.agora = 2_000;
    expect((await pedir(app, 'tenant-janelas')).status).toBe(200);
  });

  it('Retry-After mínimo é 1 segundo mesmo quando janela expira exatamente agora', async () => {
    const relogio = { agora: 0 };
    const app = buildApp(1, 1_000, relogio);

    await pedir(app, 'tenant-min');

    // Avança exatamente até o fim da janela (mas a janela ainda não resetou —
    // o contador já existe e só reseta na PRÓXIMA requisição dentro da janela)
    // O window reset só acontece quando agora - inicioMs >= janelaMs.
    // Na posição 999ms: ainda dentro da janela → Retry-After = ceil((1000 - 999)/1000) = 1
    relogio.agora = 999;
    const bloqueado = await pedir(app, 'tenant-min');
    expect(bloqueado.status).toBe(429);
    expect(Number(bloqueado.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });
});
