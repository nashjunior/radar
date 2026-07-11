/**
 * Rota: GET /api/me
 *
 * Resolve o ContextoAutorizacaoDTO do usuário autenticado — `{ usuarioId,
 * tenantId, papel, clienteFinalIds[] }` (docs/14 §6). É o contrato que o
 * front consome para decidir o que exibir (RAD-203) — não adiciona campos de
 * PII além desses.
 *
 * Não passa pelo middleware `autorizar(recurso, acao)`: resolver o próprio
 * papel É a operação (não há recurso alheio sendo acessado). Sem atribuição
 * para o `sub` ⇒ 403 PAPEL_NAO_AUTORIZADO (nunca 500, nunca "passa").
 *
 * Refs: docs/14 §6, docs/05 §4, RAD-212.
 */

import { Hono } from 'hono';
import { AcessoNegadoError } from '@radar/kernel';
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
        { usuarioId: c.get('usuarioId'), tenantId: c.get('tenantId') },
        signal,
      );
      return c.json(contexto, 200);
    } catch (err) {
      if (err instanceof AcessoNegadoError) {
        console.warn('[API] RBAC negado — sem atribuição de papel para o usuário autenticado');
        return c.json(
          { code: 'PAPEL_NAO_AUTORIZADO', mensagem: 'Papel não autorizado para esta ação.' },
          403,
        );
      }
      throw err;
    }
  });

  return router;
}
