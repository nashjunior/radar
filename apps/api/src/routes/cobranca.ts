/**
 * Rotas do contexto Cobrança & Assinatura — apps/api (RAD-264).
 *
 * GET /api/me/assinatura
 *   Leitura do agregado Assinatura do tenant autenticado (RAD-264, contrato
 *   prometido à Flávia em RAD-251/RAD-256). `tenantId` vem SEMPRE do claim JWT
 *   verificado (`middleware/tenant.ts`) — nunca de header/body. Não passa por
 *   `autorizar(recurso, acao)`: ler a PRÓPRIA assinatura não é acesso a objeto
 *   alheio (mesmo racional de `routes/me.ts`).
 *
 * POST /api/checkout/iniciar
 *   Abre o checkout hospedado do gateway de pagamento (RAD-249) para o plano
 *   informado. Devolve só a URL — o retorno do checkout NÃO ativa nada
 *   (P-107 (6)); ativação é exclusiva do webhook `invoice.paid` (RAD-250).
 *
 * De propósito NÃO existe `GET /api/checkout/status` (decisão de arquitetura,
 * RAD-256/RAD-264): o limbo "pagamento em processamento" resolve fazendo
 * polling de `GET /api/me/assinatura` até `estado = "ativa"` — uma 2ª rota
 * reintroduziria o gateway no caminho síncrono e criaria uma 2ª fonte de
 * verdade.
 *
 * Refs: RAD-246, RAD-247, RAD-249, RAD-250, RAD-251, RAD-256, RAD-264, P-107.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { ConsultarAssinaturaUseCase, IniciarCheckoutUseCase } from '@radar/cobranca';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';
import type { ExigirOrganizacaoMiddleware } from '../middleware/tenant.js';

export interface AssinaturaContainer {
  consultarAssinatura: ConsultarAssinaturaUseCase;
  exigirOrganizacao: ExigirOrganizacaoMiddleware;
}

export interface CheckoutContainer {
  iniciarCheckout: IniciarCheckoutUseCase;
  exigirOrganizacao: ExigirOrganizacaoMiddleware;
}

const IniciarCheckoutBodySchema = z.object({
  planoCodigo: z.string().min(1),
}).strict();

export function criarAssinaturaRouter(container: AssinaturaContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', container.exigirOrganizacao);
  router.use('/*', rateLimitPorTenantMiddleware);

  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    try {
      const dto = await container.consultarAssinatura.executar({ tenantId }, signal);
      return c.json(dto, 200);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}

export function criarCheckoutRouter(container: CheckoutContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', container.exigirOrganizacao);
  router.use('/*', rateLimitPorTenantMiddleware);

  router.post('/iniciar', async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    const parsed = IniciarCheckoutBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ code: 'BODY_INVALIDO', mensagem: 'Campo "planoCodigo" (string) obrigatório.' }, 400);
    }

    try {
      const resultado = await container.iniciarCheckout.executar(
        { tenantId, planoCodigo: parsed.data.planoCodigo },
        signal,
      );
      return c.json(resultado, 200);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
