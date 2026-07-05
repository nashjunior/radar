/**
 * Middleware de autenticação e derivação de tenant.
 *
 * Valida o JWT OIDC emitido pelo IdP (Amazon Cognito, P-08) e constrói o
 * tenantId a partir de claim verificado. Requisição sem token válido é
 * rejeitada com 401; claim de tenant ausente resulta em 403.
 *
 * O header x-tenant-id do cliente NÃO é mais fonte de autoridade (A08 §5,
 * §11). O tenantId é branded type — construído somente na borda da infra
 * (A10 §8). Fecha a dimensão de autenticação de P-51/anti-BOLA.
 *
 * Refs: A08 §3 (Cognito como IdP), A08 §5 (topologia), docs/05 §4, P-08.
 */

import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { TenantId } from '@radar/kernel';

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: ReturnType<typeof TenantId>;
  }
}

const region = process.env['COGNITO_REGION'] ?? 'sa-east-1';
const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? '';
const clientId = process.env['COGNITO_CLIENT_ID'] ?? '';
const tenantClaim = process.env['COGNITO_TENANT_CLAIM'] ?? 'custom:tenantId';

const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

// JWKS carregados e cacheados lazily pelo jose na primeira verificação (RFC 7517)
const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export const autenticarMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return c.json({ code: 'TOKEN_AUSENTE', mensagem: 'Token de autenticação obrigatório.' }, 401);
  }

  const token = authHeader.slice(7).trim();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, { issuer, audience: clientId }));
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
