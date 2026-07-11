import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { createMiddleware } from 'hono/factory';

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseOrigins(raw: string | undefined): readonly string[] {
  return raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0) ?? [];
}

const configuredOrigins = parseOrigins(process.env['API_CORS_ORIGINS']);
const corsOrigins =
  configuredOrigins.length > 0 || process.env['NODE_ENV'] === 'production'
    ? configuredOrigins
    : DEV_CORS_ORIGINS;

function isSameOrigin(origin: string, c: Context): boolean {
  return origin === new URL(c.req.url).origin;
}

function isAllowedOrigin(origin: string, c: Context): boolean {
  return isSameOrigin(origin, c) || corsOrigins.includes(origin);
}

export const securityHeadersMiddleware = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
  },
  referrerPolicy: 'no-referrer',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
});

export const corsMiddleware = cors({
  origin: (origin, c) => (isAllowedOrigin(origin, c) ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
  maxAge: 600,
});

export const csrfMiddleware = csrf({
  origin: isAllowedOrigin,
  secFetchSite: ['same-origin', 'same-site', 'none'],
});

// ---------------------------------------------------------------------------
// Rate-limit por tenant (P-55, RAD-209).
//
// O WAF (infra/terraform/modules/waf) cobre o bulkhead grosso por IP na borda,
// mas não consegue agregar por tenant: o tenantId vem de claim verificado do
// JWT (P-08/P-91), e o WAF não valida assinatura de token. Este middleware só
// pode rodar DEPOIS do autenticarMiddleware ter derivado `c.get('tenantId')` —
// nunca deve ser keyed em header do cliente (arquitetura/08 §5).
//
// Contador em memória de processo: o tier sempre-ligado escala de min a
// `max_capacity` tasks (infra/terraform/modules/compute, prod = 2..6 —
// stacks/prod/main.tf), sem Redis/contador compartilhado na IaC hoje. Decisão
// (a) do escopo da issue: o teto global por tenant é dividido pelo maior
// `max_capacity` entre os stacks, então cada task aplica um teto mais
// apertado — em regime de scale-out completo o agregado das tasks converge
// para o teto pretendido; com menos tasks ativas (fora de pico) o teto
// efetivo fica mais estrito que o pretendido. Folga aceita no MVP-Now, sem
// infra nova; reabre para (b) contador compartilhado se o teto apertado demais
// virar reclamação real (docs/98 P-55).
// ---------------------------------------------------------------------------

export interface RateLimitTenantOptions {
  /** Duração da janela deslizante-fixa, em ms. */
  janelaMs: number;
  /** Teto de requisições por tenant, por janela, aplicado em CADA task. */
  tetoPorTask: number;
  /** Injetável em teste; produção usa Date.now. */
  agoraMs?: () => number;
}

interface JanelaTenant {
  inicioMs: number;
  contagem: number;
}

/**
 * Fábrica do middleware de rate-limit por tenant. Recebe configuração
 * explícita (janela/teto/relógio) para permitir testes determinísticos sem
 * esperar tempo real — mesmo padrão de `criarAutenticarMiddleware`.
 *
 * Deve ser montado DEPOIS de `autenticarMiddleware` na cadeia da rota.
 */
export function criarRateLimitPorTenantMiddleware(opts: RateLimitTenantOptions) {
  const janelasPorTenant = new Map<string, JanelaTenant>();
  const agoraMs = opts.agoraMs ?? Date.now;

  return createMiddleware(async (c, next) => {
    const tenantId = c.get('tenantId');
    const agora = agoraMs();

    let janela = janelasPorTenant.get(tenantId);
    if (!janela || agora - janela.inicioMs >= opts.janelaMs) {
      janela = { inicioMs: agora, contagem: 0 };
      janelasPorTenant.set(tenantId, janela);
    }

    janela.contagem += 1;

    if (janela.contagem > opts.tetoPorTask) {
      const retryAfterSegundos = Math.max(
        1,
        Math.ceil((janela.inicioMs + opts.janelaMs - agora) / 1000),
      );
      c.header('Retry-After', String(retryAfterSegundos));
      return c.json(
        { code: 'LIMITE_REQUISICOES_EXCEDIDO', mensagem: 'Limite de requisições excedido. Tente novamente em instantes.' },
        429,
      );
    }

    await next();
  });
}

function inteiroPositivoOuPadrao(raw: string | undefined, padrao: number): number {
  if (raw === undefined || raw === '') return padrao;
  const valor = Number(raw);
  return Number.isInteger(valor) && valor > 0 ? valor : padrao;
}

/** 10 req/s sustentado por tenant — piso inicial do MVP-Now, ajustável via env sem deploy de código. */
const RATE_LIMIT_TETO_GLOBAL_PADRAO = 600;
const RATE_LIMIT_JANELA_MS_PADRAO = 60_000;
/** Maior `max_capacity` entre os stacks (prod, infra/terraform/stacks/prod/main.tf) — teto conservador por padrão. */
const RATE_LIMIT_MAX_TASKS_PADRAO = 6;

const rateLimitJanelaMs = inteiroPositivoOuPadrao(
  process.env['RATE_LIMIT_TENANT_JANELA_MS'],
  RATE_LIMIT_JANELA_MS_PADRAO,
);
const rateLimitTetoGlobal = inteiroPositivoOuPadrao(
  process.env['RATE_LIMIT_TENANT_TETO_GLOBAL'],
  RATE_LIMIT_TETO_GLOBAL_PADRAO,
);
const rateLimitMaxTasks = inteiroPositivoOuPadrao(
  process.env['RATE_LIMIT_TENANT_MAX_TASKS'],
  RATE_LIMIT_MAX_TASKS_PADRAO,
);

export const rateLimitPorTenantMiddleware = criarRateLimitPorTenantMiddleware({
  janelaMs: rateLimitJanelaMs,
  tetoPorTask: Math.ceil(rateLimitTetoGlobal / rateLimitMaxTasks),
});
