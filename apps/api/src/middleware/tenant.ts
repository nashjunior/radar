/**
 * Middleware de autenticação e derivação de tenant.
 *
 * Suporta dois modos (gated por AUTH_MODE):
 *   - cognito (padrão): valida JWT OIDC contra JWKS do Amazon Cognito (P-08).
 *   - dev: valida JWT HS256 assinado com AUTH_DEV_SECRET — sem Cognito vivo.
 *
 * Invariante P-91: AUTH_MODE=dev é recusado em NODE_ENV=production. O processo
 * aborta no startup via resolverConfigAuth (chamada em index.ts antes de
 * aceitar requests) — nunca aceita token de dev em prod.
 *
 * Invariante AB3: no modo cognito, somente token_use=id é aceito. O front envia
 * id_token (contém custom:tenantId); access_token não carrega a claim.
 *
 * Invariante RBAC (P-52, docs/14 §6): o `sub` do token verificado é extraído
 * como `usuarioId` — identidade do usuário para o PermissaoRepository. Papel
 * e escopo de clienteFinalId NUNCA vêm do token (são dado de domínio de
 * Identidade & Organização, resolvidos na borda por autorizacao.ts).
 *
 * Refs: A08 §3 (Cognito como IdP), A08 §5 (topologia), docs/05 §4, docs/14 §6, P-08, P-91, P-52.
 */

import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { TenantId } from '@radar/kernel';
import { UsuarioId } from '@radar/identidade';

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: ReturnType<typeof TenantId>;
    usuarioId: UsuarioId;
  }
}

export type AuthMode = 'cognito' | 'dev';

/**
 * Valida a configuração de autenticação a partir das env vars recebidas.
 * Invariante DURO (P-91): AUTH_MODE=dev é proibido em NODE_ENV=production.
 * Lança Error descritivo em caso de config inválida; sem efeitos colaterais.
 */
export function resolverConfigAuth(env: Record<string, string | undefined>): void {
  const mode = env['AUTH_MODE'];

  if (env['NODE_ENV'] === 'production' && mode === 'dev') {
    throw new Error('AUTH_MODE=dev é proibido em NODE_ENV=production (P-91).');
  }

  if (mode === 'dev') {
    if (!env['AUTH_DEV_SECRET']) {
      throw new Error('AUTH_DEV_SECRET é obrigatório em AUTH_MODE=dev.');
    }
    return;
  }

  // modo cognito — vars obrigatórias
  if (!env['COGNITO_USER_POOL_ID']) throw new Error('COGNITO_USER_POOL_ID é obrigatório.');
  if (!env['COGNITO_CLIENT_ID']) throw new Error('COGNITO_CLIENT_ID é obrigatório.');
}

export interface CognitoMiddlewareOpts {
  authMode: AuthMode;
  /** JWKS verifier para modo cognito; null em modo dev. */
  jwks: JWTVerifyGetKey | null;
  devSecret: string;
  issuer: string;
  clientId: string;
  tenantClaim: string;
}

/**
 * Fábrica do middleware de autenticação. Recebe configuração explícita para
 * permitir testes unitários com chaves locais sem chamadas de rede.
 */
export function criarAutenticarMiddleware(opts: CognitoMiddlewareOpts) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.toLowerCase().startsWith('bearer ')) {
      return c.json({ code: 'TOKEN_AUSENTE', mensagem: 'Token de autenticação obrigatório.' }, 401);
    }

    const token = authHeader.slice(7).trim();
    let payload: JWTPayload;

    try {
      if (opts.authMode === 'dev') {
        const key = createSecretKey(Buffer.from(opts.devSecret, 'utf-8'));
        ({ payload } = await jwtVerify(token, key));
      } else {
        ({ payload } = await jwtVerify(token, opts.jwks!, {
          issuer: opts.issuer,
          audience: opts.clientId,
        }));

        // AB3: somente id_token é aceito; access_token não carrega custom:tenantId.
        if (payload['token_use'] !== 'id') {
          return c.json(
            { code: 'TOKEN_USE_INVALIDO', mensagem: 'Somente id_token do Cognito é aceito.' },
            401,
          );
        }
      }
    } catch {
      return c.json({ code: 'TOKEN_INVALIDO', mensagem: 'Token inválido ou expirado.' }, 401);
    }

    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.trim() === '') {
      return c.json(
        { code: 'SUB_AUSENTE_NO_TOKEN', mensagem: 'Identidade do usuário ausente no token.' },
        401,
      );
    }

    const claim = payload[opts.tenantClaim];
    if (typeof claim !== 'string' || claim.trim() === '') {
      return c.json(
        { code: 'TENANT_AUSENTE_NO_TOKEN', mensagem: 'Claim de tenant ausente no token.' },
        403,
      );
    }

    c.set('tenantId', TenantId(claim.trim()));
    c.set('usuarioId', UsuarioId(sub.trim()));
    await next();
  });
}

// ---------------------------------------------------------------------------
// Instância padrão — configurada via process.env no startup.
// ---------------------------------------------------------------------------

const authMode: AuthMode = process.env['AUTH_MODE'] === 'dev' ? 'dev' : 'cognito';
const tenantClaim = process.env['COGNITO_TENANT_CLAIM'] ?? 'custom:tenantId';

const region = process.env['COGNITO_REGION'] ?? 'sa-east-1';
const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? '';
const clientId = process.env['COGNITO_CLIENT_ID'] ?? '';
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

// JWKS carregado e cacheado lazily pelo jose (RFC 7517) — apenas no modo cognito.
const JWKS =
  authMode !== 'dev'
    ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    : null;

// Segredo HMAC lido apenas quando AUTH_MODE=dev.
const devSecret = authMode === 'dev' ? (process.env['AUTH_DEV_SECRET'] ?? '') : '';

export const autenticarMiddleware = criarAutenticarMiddleware({
  authMode,
  jwks: JWKS,
  devSecret,
  issuer,
  clientId,
  tenantClaim,
});
