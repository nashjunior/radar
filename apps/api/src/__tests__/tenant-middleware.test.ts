/**
 * Testes runtime do autenticarMiddleware — cenários AB3 (RAD-131).
 *
 * Usa chave RSA local (sem chamada de rede a Cognito) via createLocalJWKSet.
 * Cobre: token ausente, expirado, issuer errado, audience errada, token_use
 * errado, tenant claim ausente/vazia, happy path cognito, happy path dev.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import type { GenerateKeyPairResult } from 'jose';
import { criarAutenticarMiddleware } from '../middleware/tenant.js';

const ISSUER = 'https://cognito-idp.sa-east-1.amazonaws.com/sa-east-1_TEST';
const CLIENT_ID = 'test-client-id';
const TENANT_CLAIM = 'custom:tenantId';
const TENANT_ID = 'tenant-abc';
const KID = 'test-key-1';

let privateKey: GenerateKeyPairResult['privateKey'];
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;

  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function buildApp() {
  const app = new Hono();
  app.use('*', criarAutenticarMiddleware({
    authMode: 'cognito',
    jwks,
    devSecret: '',
    issuer: ISSUER,
    clientId: CLIENT_ID,
    tenantClaim: TENANT_CLAIM,
  }));
  app.get('/ping', (c) => c.json({ tenantId: c.get('tenantId') }));
  return app;
}

function validToken(overrides: Record<string, unknown> = {}, expiresIn = '1h') {
  return new SignJWT({
    [TENANT_CLAIM]: TENANT_ID,
    token_use: 'id',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(privateKey);
}

describe('autenticarMiddleware — cognito mode (AB3)', () => {
  it('401 quando header Authorization ausente', async () => {
    const app = buildApp();
    const res = await app.request('/ping');
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_AUSENTE');
  });

  it('401 quando header não começa com Bearer', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_AUSENTE');
  });

  it('200 e tenantId derivado em happy path', async () => {
    const app = buildApp();
    const token = await validToken();
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    expect(body.tenantId).toBe(TENANT_ID);
  });

  it('401 TOKEN_INVALIDO quando token expirado', async () => {
    const app = buildApp();
    const token = await validToken({}, '-1s');
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_INVALIDO');
  });

  it('401 TOKEN_INVALIDO quando issuer errado', async () => {
    const app = buildApp();
    const token = await new SignJWT({ [TENANT_CLAIM]: TENANT_ID, token_use: 'id' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://cognito-idp.us-east-1.amazonaws.com/wrong-pool')
      .setAudience(CLIENT_ID)
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKey);
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_INVALIDO');
  });

  it('401 TOKEN_INVALIDO quando audience/client_id errado', async () => {
    const app = buildApp();
    const token = await new SignJWT({ [TENANT_CLAIM]: TENANT_ID, token_use: 'id' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience('outro-client-id')
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(privateKey);
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_INVALIDO');
  });

  it('401 TOKEN_USE_INVALIDO quando token_use=access (AB3)', async () => {
    const app = buildApp();
    const token = await validToken({ token_use: 'access' });
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_USE_INVALIDO');
  });

  it('401 TOKEN_USE_INVALIDO quando token_use ausente (AB3)', async () => {
    const app = buildApp();
    const token = await validToken({ token_use: undefined });
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_USE_INVALIDO');
  });

  it('403 TENANT_AUSENTE_NO_TOKEN quando claim custom:tenantId ausente', async () => {
    const app = buildApp();
    const token = await validToken({ [TENANT_CLAIM]: undefined });
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TENANT_AUSENTE_NO_TOKEN');
  });

  it('403 TENANT_AUSENTE_NO_TOKEN quando claim custom:tenantId é string vazia', async () => {
    const app = buildApp();
    const token = await validToken({ [TENANT_CLAIM]: '   ' });
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TENANT_AUSENTE_NO_TOKEN');
  });

  it('401 quando x-tenant-id está presente mas token ausente (sem fallback de header)', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'x-tenant-id': 'tenant-injetado' },
    });
    // Sem Bearer, deve rejeitar — não usa header alternativo
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('TOKEN_AUSENTE');
  });
});

describe('autenticarMiddleware — dev mode', () => {
  const DEV_SECRET = 'segredo-de-dev-minimo-32-caracteres-ok!!';

  function buildDevApp() {
    const app = new Hono();
    app.use('*', criarAutenticarMiddleware({
      authMode: 'dev',
      jwks: null,
      devSecret: DEV_SECRET,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      tenantClaim: TENANT_CLAIM,
    }));
    app.get('/ping', (c) => c.json({ tenantId: c.get('tenantId') }));
    return app;
  }

  it('200 com HS256 dev token válido', async () => {
    const { SignJWT: SignJWTLocal } = await import('jose');
    const { createSecretKey: nodeCreateSecretKey } = await import('node:crypto');
    const key = nodeCreateSecretKey(Buffer.from(DEV_SECRET, 'utf-8'));
    const token = await new SignJWTLocal({ [TENANT_CLAIM]: 'tenant-dev' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(key);

    const app = buildDevApp();
    const res = await app.request('/ping', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    expect(body.tenantId).toBe('tenant-dev');
  });
});
