/**
 * Middleware de autenticação e resolução de organização.
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
 * id_token (contém custom:tenantId quando presente); access_token não carrega a claim.
 *
 * RAD-283/RAD-285 (docs/14 §6): a claim de tenant DEIXOU de ser pré-condição da
 * sessão — ela é imutável e só populável na criação do usuário no Cognito, então
 * uma conta de self-signup nunca a carrega. `autenticarMiddleware` agora só exige
 * `sub` (identidade verificada); `tenantClaimId` é opcional e vira cross-check em
 * `exigirOrganizacaoMiddleware`, nunca fonte de verdade. Papel e `tenantId` são
 * dado de domínio de Identidade & Organização, lidos por `PermissaoRepository`
 * chaveado pelo `sub` — nunca do token (P-52).
 *
 * Refs: A08 §3 (Cognito como IdP), A08 §5 (topologia), docs/05 §4, docs/14 §6, P-08, P-91, P-52.
 */

import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { TenantId, AcessoNegadoError } from '@radar/kernel';
import { UsuarioId, SemOrganizacaoError } from '@radar/identidade';
import type { ContextoAutorizacaoDTO, ResolverContextoAutorizacaoUseCase } from '@radar/identidade';

declare module 'hono' {
  interface ContextVariableMap {
    /** Resolvido pelo NOSSO banco (`ResolverContextoAutorizacaoUseCase`) — nunca do token. Setado por `exigirOrganizacaoMiddleware`. */
    tenantId: ReturnType<typeof TenantId>;
    usuarioId: UsuarioId;
    /** `custom:tenantId` do token, só quando presente (contas de `AdminCreateUser`) — cross-check opcional, nunca fonte de verdade. */
    tenantClaimId: ReturnType<typeof TenantId> | null;
    /** Claim `email` do id_token, quando presente — usado só no onboarding (`POST /api/organizacoes`), nunca persistido além do Tenant/KYC. */
    usuarioEmail: string | null;
    contextoAutorizacao: ContextoAutorizacaoDTO;
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
 *
 * Só verifica identidade (`sub`) — resolução de organização é
 * `exigirOrganizacaoMiddleware`, uma etapa separada (RAD-285): `GET /api/me` e
 * `POST /api/organizacoes` usam SÓ este middleware, isentos de tenant.
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
    const tenantClaimId = typeof claim === 'string' && claim.trim() !== '' ? TenantId(claim.trim()) : null;

    const email = payload['email'];

    c.set('usuarioId', UsuarioId(sub.trim()));
    c.set('tenantClaimId', tenantClaimId);
    c.set('usuarioEmail', typeof email === 'string' && email.trim() !== '' ? email.trim() : null);
    await next();
  });
}

export interface ExigirOrganizacaoDeps {
  resolverContexto: ResolverContextoAutorizacaoUseCase;
}

/**
 * Resolve `tenantId`/papel/`clienteFinalIds` via `PermissaoRepository`, chaveado
 * pelo `sub` verificado (RAD-283/RAD-285, docs/14 §6). Monta DEPOIS de
 * `autenticarMiddleware`, em toda rota de negócio — nunca em `/api/me` ou
 * `/api/organizacoes` (isentas de tenant). Cacheia `contextoAutorizacao` no
 * Context da requisição — `autorizar(recurso, acao)` reaproveita sem nova consulta.
 *
 * Sem atribuição para o `sub` não é 403 cego: é o estado "sem organização"
 * (`SEM_ORGANIZACAO`) que direciona o front ao onboarding. Divergência entre
 * `tenantClaimId` (quando presente, contas `AdminCreateUser`) e o registro é
 * `ACESSO_NEGADO`.
 */
export function criarExigirOrganizacaoMiddleware(deps: ExigirOrganizacaoDeps) {
  return createMiddleware(async (c, next) => {
    const signal = c.req.raw.signal;

    try {
      const contexto = await deps.resolverContexto.executar(
        { usuarioId: c.get('usuarioId'), tenantClaim: c.get('tenantClaimId') },
        signal,
      );
      c.set('tenantId', contexto.tenantId);
      c.set('contextoAutorizacao', contexto);
    } catch (err) {
      if (err instanceof SemOrganizacaoError) {
        return c.json(
          { code: 'SEM_ORGANIZACAO', mensagem: 'Usuário autenticado sem organização provisionada.' },
          403,
        );
      }
      if (err instanceof AcessoNegadoError) {
        return c.json({ code: 'ACESSO_NEGADO', mensagem: 'Acesso negado.' }, 403);
      }
      throw err;
    }

    await next();
  });
}

export type ExigirOrganizacaoMiddleware = ReturnType<typeof criarExigirOrganizacaoMiddleware>;

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
const JWKS: JWTVerifyGetKey | null =
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
