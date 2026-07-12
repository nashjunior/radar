/**
 * Rotas de leitura de alertas — apps/api.
 *
 * GET /api/alertas
 *   US-05: Lista todos os alertas gerados para o tenant autenticado.
 *   tenantId vem do JWT via autenticarMiddleware — nunca do corpo.
 *   Autorização por objeto (P-51/AB1): AlertaRepository.listarPorTenant
 *   usa o tenantId como scope; cross-tenant é impossível.
 *   Retorna 200 AlertaDTO[] (vazio quando não há alertas).
 *
 * RBAC (P-52): ALERTA ler — docs/05 §4.
 *
 * Refs: docs/14 §2 (US-05), P-51, P-52, arquitetura/17 §5.3, RAD-115 (proveniência).
 */

import { Hono } from 'hono';
import type { ConsultarAlertasTenantUseCase } from '@radar/matching';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';
import type { AutorizarMiddleware } from '../middleware/autorizacao.js';
import type { ExigirOrganizacaoMiddleware } from '../middleware/tenant.js';

export interface AlertasContainer {
  consultarAlertas: ConsultarAlertasTenantUseCase;
  autorizar: AutorizarMiddleware;
  exigirOrganizacao: ExigirOrganizacaoMiddleware;
}

export function criarAlertasRouter(container: AlertasContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', container.exigirOrganizacao);
  router.use('/*', rateLimitPorTenantMiddleware);

  // GET / — US-05 ConsultarAlertasTenant — RBAC: ALERTA ler
  router.get('/', container.autorizar('ALERTA', 'ler'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    try {
      const resultado = await container.consultarAlertas.executar({ tenantId }, signal);
      return c.json(resultado);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
