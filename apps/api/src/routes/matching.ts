/**
 * Rotas do contexto Matching — apps/api.
 *
 * POST /api/matching/criterios
 *   US-04: Define critério de monitoramento para o clienteFinal autenticado.
 *   clienteFinalId vem do contexto de auth (via perfilAtivo), nunca do corpo.
 *   Depende de FaixaValorReferencia (adapter de produção via RAD-76; stub retorna []).
 *
 * PATCH /api/matching/alertas/:alertaId/feedback
 *   US-06: Marca alerta como relevante/irrelevante.
 *   Autorização por objeto (P-51/AB1): verificada no use case — alertaId deve
 *   pertencer ao clienteFinalId do token; caso contrário → 403.
 *   Pode ser usado independente de RAD-76.
 *
 * GET /api/matching/metricas
 *   RAD-78: Expõe precisão (P-14) e ativação (docs/08 §3) do tenant autenticado.
 *   Gate P-21: somente leitura — nenhum limiar de matching é alterado.
 *
 * RBAC (P-52, docs/05 §4): CRITERIO_MONITORAMENTO criar (POST /criterios);
 * ALERTA decidir (PATCH feedback); ALERTA ler (GET /metricas — precisão é
 * derivada do feedback de alerta, P-14).
 *
 * Refs: RAD-77, RAD-78, docs/14 §2 (US-04/US-06), arquitetura/17 §5.3 (authz por objeto),
 *       modules/matching/src/application/use-cases/*, P-51, P-52.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { AlertaId } from '@radar/kernel';
import type {
  ConsultarMetricasMatchingUseCase,
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';
import type { AutorizarMiddleware } from '../middleware/autorizacao.js';

export interface MatchingContainer {
  definirCriterio: DefinirCriterioMonitoramentoUseCase;
  registrarFeedback: RegistrarFeedbackAlertaUseCase;
  consultarMetricas: ConsultarMetricasMatchingUseCase;
  perfilAtivo: PerfilAtivoGateway;
  autorizar: AutorizarMiddleware;
}

const DefinirCriterioBodySchema = z.object({
  ramoCnae: z.string().optional(),
  regiaoUf: z.string().optional(),
  faixaValorCodigo: z.string().optional(),
  palavrasChave: z.array(z.string()).optional(),
}).strict();

const FeedbackBodySchema = z.object({
  relevante: z.boolean(),
}).strict();

export function criarMatchingRouter(container: MatchingContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', rateLimitPorTenantMiddleware);

  // POST /criterios — US-04 DefinirCritérioMonitoramento — RBAC: CRITERIO_MONITORAMENTO criar
  router.post('/criterios', container.autorizar('CRITERIO_MONITORAMENTO', 'criar'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    const parsed = DefinirCriterioBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ code: 'BODY_INVALIDO', mensagem: 'Corpo da requisição inválido.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const { clienteFinalId } = perfil;
      const { ramoCnae, regiaoUf, faixaValorCodigo, palavrasChave } = parsed.data;
      const resultado = await container.definirCriterio.executar(
        {
          tenantId,
          clienteFinalId,
          ...(ramoCnae !== undefined ? { ramoCnae } : {}),
          ...(regiaoUf !== undefined ? { regiaoUf } : {}),
          ...(faixaValorCodigo !== undefined ? { faixaValorCodigo } : {}),
          ...(palavrasChave !== undefined ? { palavrasChave } : {}),
        },
        signal,
      );

      return c.json(resultado, 201);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // GET /metricas — RAD-78 ConsultarMetricasMatching — RBAC: ALERTA ler
  router.get('/metricas', container.autorizar('ALERTA', 'ler'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;
    const janelaParam = c.req.query('janelaEmDias');
    const janelaEmDias = janelaParam ? Number(janelaParam) : undefined;

    if (janelaEmDias !== undefined && (!Number.isInteger(janelaEmDias) || janelaEmDias < 1)) {
      return c.json({ code: 'PARAMETRO_INVALIDO', mensagem: 'janelaEmDias deve ser inteiro positivo.' }, 400);
    }

    try {
      const resultado = await container.consultarMetricas.executar(
        { tenantId, ...(janelaEmDias !== undefined ? { janelaEmDias } : {}) },
        signal,
      );
      return c.json(resultado);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // PATCH /alertas/:alertaId/feedback — US-06 RegistrarFeedbackAlerta — RBAC: ALERTA decidir
  router.patch('/alertas/:alertaId/feedback', container.autorizar('ALERTA', 'decidir'), async (c) => {
    const alertaIdRaw = c.req.param('alertaId');
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    const parsed = FeedbackBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ code: 'BODY_INVALIDO', mensagem: 'Campo "relevante" (boolean) obrigatório.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const { clienteFinalId } = perfil;
      await container.registrarFeedback.executar(
        {
          alertaId: AlertaId(alertaIdRaw),
          relevante: parsed.data.relevante,
          clienteFinalId,
        },
        signal,
      );

      return new Response(null, { status: 204 });
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
