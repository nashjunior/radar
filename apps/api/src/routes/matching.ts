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
 * Refs: RAD-77, RAD-78, docs/14 §2 (US-04/US-06), arquitetura/17 §5.3 (authz por objeto),
 *       modules/matching/src/application/use-cases/*, P-51.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { AlertaId } from '@radar/kernel';
import type { TenantId } from '@radar/kernel';
import type {
  ConsultarMetricasMatchingUseCase,
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';

export interface MatchingContainer {
  definirCriterio: DefinirCriterioMonitoramentoUseCase;
  registrarFeedback: RegistrarFeedbackAlertaUseCase;
  consultarMetricas: ConsultarMetricasMatchingUseCase;
  perfilAtivo: PerfilAtivoGateway;
  /** Rematch síncrono do lote demo após salvar critério (dev). */
  rematchAposSalvar?: (tenantId: TenantId, signal: AbortSignal) => Promise<number>;
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

  // POST /criterios — US-04 DefinirCritérioMonitoramento
  router.post('/criterios', async (c) => {
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

      let alertasGerados = 0;
      if (container.rematchAposSalvar) {
        try {
          alertasGerados = await container.rematchAposSalvar(tenantId, signal);
        } catch (err) {
          console.warn(
            '[matching/criterios] rematch falhou:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      return c.json({ ...resultado, alertasGerados }, 201);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // GET /metricas — RAD-78 ConsultarMetricasMatching
  router.get('/metricas', async (c) => {
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

  // PATCH /alertas/:alertaId/feedback — US-06 RegistrarFeedbackAlerta
  router.patch('/alertas/:alertaId/feedback', async (c) => {
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
