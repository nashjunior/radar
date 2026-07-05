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
 * Refs: A08 §3 (Cognito como IdP), A08 §5 (topologia), docs/05 §4, P-08, P-91.
 */

import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import type { JWTPayload } from 'jose';
import { TenantId } from '@radar/kernel';

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: ReturnType<typeof TenantId>;
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

export const autenticarMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return c.json({ code: 'TOKEN_AUSENTE', mensagem: 'Token de autenticação obrigatório.' }, 401);
  }

  const token = authHeader.slice(7).trim();
  let payload: JWTPayload;

  try {
    if (authMode === 'dev') {
      const key = createSecretKey(Buffer.from(devSecret, 'utf-8'));
      ({ payload } = await jwtVerify(token, key));
    } else {
      ({ payload } = await jwtVerify(token, JWKS!, { issuer, audience: clientId }));
    }
  } catch {
    return c.json({ code: 'TOKEN_INVALIDO', mensagem: 'Token inválido ou expirado.' }, 401);
  }

  const claim = payload[tenantClaim];
  if (typeof claim !== 'string' || claim.trim() === '') {
    return c.json(
      { code: 'TENANT_AUSENTE_NO_TOKEN', mensagem: 'Claim de tenant ausente no token.' },
      403,
    );
  }

  c.set('tenantId', TenantId(claim.trim()));
  await next();
});
