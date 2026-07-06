/**
 * Rotas: PUT /api/identidade/perfil
 *
 * Upsert do Perfil de Habilitação do cliente final autenticado (US-P1, docs/14 §6).
 * Autorização por objeto (P-51): o use case verifica tenant + clienteFinalId antes de salvar.
 * AbortSignal derivado do request propaga cancelamento ao use case (P-78).
 *
 * PUT  200 → perfil criado ou atualizado (DTO completo)
 *      403 → tenant divergente no perfil existente
 *      400 → corpo inválido
 *      404 → tenant desconhecido (perfil ativo não encontrado)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { GerenciarPerfilHabilitacaoUseCase } from '@radar/identidade';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';

export interface IdentidadeContainer {
  gerenciarPerfil: GerenciarPerfilHabilitacaoUseCase;
  perfilAtivo: PerfilAtivoGateway;
}

const PerfilBodySchema = z.object({
  habJuridica: z.array(z.string()),
  habFiscal: z.array(z.string()),
  habTecnica: z.array(z.string()),
  habEconomica: z.array(z.string()),
});

export function criarIdentidadeRouter(container: IdentidadeContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);

  // PUT /api/identidade/perfil — upsert das dimensões de habilitação (RAD-109)
  router.put('/perfil', async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let body: z.infer<typeof PerfilBodySchema>;
    try {
      const raw = await c.req.json();
      body = PerfilBodySchema.parse(raw);
    } catch {
      return c.json({ code: 'CORPO_INVALIDO', mensagem: 'Corpo inválido. Campos habJuridica, habFiscal, habTecnica e habEconomica são arrays de string obrigatórios.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const dto = await container.gerenciarPerfil.executar(
        {
          tenantId,
          clienteFinalId: perfil.clienteFinalId,
          habJuridica: body.habJuridica,
          habFiscal: body.habFiscal,
          habTecnica: body.habTecnica,
          habEconomica: body.habEconomica,
        },
        signal,
      );

      return c.json(dto, 200);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
