/**
 * Rota: POST /api/organizacoes
 *
 * Onboarding pós-login do self-signup (P-109 L3 / RAD-283/RAD-285, docs/14 §6):
 * provisiona o Tenant + a AtribuicaoPapel `ADMIN_CONSULTORIA` do primeiro usuário.
 * Isenta de tenant — só `autenticarMiddleware` (exige `sub`), nunca
 * `exigirOrganizacaoMiddleware` (o Tenant ainda não existe quando esta rota roda).
 *
 * `sub`/`email` vêm do id_token verificado (nunca do corpo); `cnpj`/`razaoSocial`
 * vêm do formulário de onboarding — dado de fronteira, validado pela `Cnpj` VO
 * (dígito verificador) antes de tocar qualquer repositório.
 *
 * Idempotente (docs/14 §6): re-chamar com o mesmo `sub` devolve a organização já
 * provisionada em vez de duplicar ou falhar.
 *
 * Refs: docs/14 §6, P-109 L3, RAD-272 (LGPD), RAD-283, RAD-285.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { ProvisionarOrganizacaoUseCase } from '@radar/identidade';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';

export interface OrganizacoesContainer {
  provisionarOrganizacao: ProvisionarOrganizacaoUseCase;
}

const ProvisionarOrganizacaoBodySchema = z.object({
  cnpj: z.string().min(1),
  razaoSocial: z.string().min(1),
}).strict();

export function criarOrganizacoesRouter(container: OrganizacoesContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', rateLimitPorTenantMiddleware);

  router.post('/', async (c) => {
    const signal = c.req.raw.signal;

    const parsed = ProvisionarOrganizacaoBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: 'CORPO_INVALIDO', mensagem: 'Campos "cnpj" e "razaoSocial" (string não-vazia) obrigatórios.' },
        400,
      );
    }

    try {
      const dto = await container.provisionarOrganizacao.executar(
        {
          sub: c.get('usuarioId'),
          email: c.get('usuarioEmail') ?? '',
          cnpj: parsed.data.cnpj,
          razaoSocial: parsed.data.razaoSocial,
        },
        signal,
      );
      return c.json(dto, 201);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
