/**
 * Middleware RBAC (P-52) — checagem de papel na borda.
 *
 * Cumulativo com a autorização por objeto (AB1/P-51), que continua dentro de
 * cada use case do contexto dono — nenhum controle substitui o outro (docs/05
 * §4, docs/14 §6). Resolve o contexto de autorização (papel + clienteFinalIds)
 * via ResolverContextoAutorizacaoUseCase e cacheia no Hono Context da
 * requisição corrente (nunca entre requisições — revogação de papel tem de
 * valer na hora, sem esperar TTL), depois checa `AutorizarAcessoUseCase`.
 *
 * Negação: 403 com code PAPEL_NAO_AUTORIZADO (distinto do ACESSO_NEGADO
 * genérico de authz por objeto), sem revelar existência do objeto, registrada
 * em log estruturado — nunca PII/token (docs/05 §3).
 *
 * Refs: docs/05 §4, docs/14 §6, arquitetura/10 §6/§8, RAD-212.
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AcessoNegadoError } from '@radar/kernel';
import { SemOrganizacaoError } from '@radar/identidade';
import type {
  Acao,
  AutorizarAcessoUseCase,
  ContextoAutorizacaoDTO,
  Recurso,
  ResolverContextoAutorizacaoUseCase,
} from '@radar/identidade';
import { redigirParaLog } from '../logging.js';

declare module 'hono' {
  interface ContextVariableMap {
    contextoAutorizacao: ContextoAutorizacaoDTO;
  }
}

export interface AutorizacaoDeps {
  resolverContexto: ResolverContextoAutorizacaoUseCase;
  autorizarAcesso: AutorizarAcessoUseCase;
}

/**
 * Resolve o ContextoAutorizacaoDTO do usuário autenticado, cacheado apenas no
 * Context desta requisição (Hono cria um Context novo por requisição — não há
 * memoização cross-request aqui, de propósito).
 */
async function resolverContextoCacheado(
  deps: Pick<AutorizacaoDeps, 'resolverContexto'>,
  c: Context,
  signal: AbortSignal,
): Promise<ContextoAutorizacaoDTO> {
  const existente = c.get('contextoAutorizacao');
  if (existente) return existente;

  const contexto = await deps.resolverContexto.executar(
    { usuarioId: c.get('usuarioId'), tenantClaim: c.get('tenantClaimId') },
    signal,
  );
  c.set('contextoAutorizacao', contexto);
  return contexto;
}

/**
 * Fábrica do middleware `autorizar(recurso, acao)` — recebe as dependências
 * (use cases) uma vez, no composition root, e devolve a fábrica por rota.
 * Deve ser montado DEPOIS de `autenticarMiddleware` (precisa de tenantId/usuarioId).
 */
export function criarAutorizarMiddlewareFactory(deps: AutorizacaoDeps) {
  return function autorizar(recurso: Recurso, acao: Acao) {
    return createMiddleware(async (c, next) => {
      const signal = c.req.raw.signal;

      try {
        const contexto = await resolverContextoCacheado(deps, c, signal);
        await deps.autorizarAcesso.executar({ contexto, recurso, acao }, signal);
      } catch (err) {
        // Defesa em profundidade: em produção `exigirOrganizacaoMiddleware` já
        // trata SEM_ORGANIZACAO antes de chegar aqui (cache warm) — este branch
        // só é alcançável se `autorizar()` for montado sem ele (não deve acontecer).
        if (err instanceof SemOrganizacaoError) {
          return c.json(
            { code: 'SEM_ORGANIZACAO', mensagem: 'Usuário autenticado sem organização provisionada.' },
            403,
          );
        }
        if (err instanceof AcessoNegadoError) {
          // tenantId NÃO vai ao log operacional/stdout (regra radar-no-critical-data-console-log,
          // docs/05 §9): o breadcrumb é só recurso+acao. O registro ESCOPADO da negação (com
          // tenantId) é responsabilidade do audit log access-controlled (RegistrarAuditoria, AB13).
          console.warn('[API] RBAC negado', redigirParaLog({ recurso, acao }));
          return c.json(
            { code: 'PAPEL_NAO_AUTORIZADO', mensagem: 'Papel não autorizado para esta ação.' },
            403,
          );
        }
        throw err;
      }

      await next();
    });
  };
}

export type AutorizarMiddleware = ReturnType<typeof criarAutorizarMiddlewareFactory>;
