/**
 * Rota: GET /api/me
 *
 * Resolve o ContextoAutorizacaoDTO do usuário autenticado — `{ usuarioId,
 * tenantId, papel, clienteFinalIds[] }` (docs/14 §6) OU o estado "sem
 * organização" (RAD-283/RAD-285) que direciona o front ao onboarding. É o
 * contrato que o front consome para decidir o que exibir (RAD-203) — não
 * adiciona campos de PII além desses.
 *
 * Isenta de tenant (RAD-285): só `autenticarMiddleware` (exige `sub`), nunca
 * `exigirOrganizacaoMiddleware` — resolver o próprio papel/organização É a
 * operação, não pressupõe que ela já exista.
 *
 * Refs: docs/14 §6, docs/05 §4, RAD-212, RAD-283, RAD-285.
 */

import { Hono } from 'hono';
import { AcessoNegadoError } from '@radar/kernel';
import { SemOrganizacaoError } from '@radar/identidade';
import type { ResolverContextoAutorizacaoUseCase } from '@radar/identidade';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';

export interface MeContainer {
  resolverContexto: ResolverContextoAutorizacaoUseCase;
}

export function criarMeRouter(container: MeContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', rateLimitPorTenantMiddleware);

  router.get('/', async (c) => {
    const signal = c.req.raw.signal;

    try {
      const contexto = await container.resolverContexto.executar(
        { usuarioId: c.get('usuarioId'), tenantClaim: c.get('tenantClaimId') },
        signal,
      );
      return c.json(contexto, 200);
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
  });

  return router;
}
