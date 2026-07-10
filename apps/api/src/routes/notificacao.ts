/**
 * Rotas do contexto Notificação — apps/api.
 *
 * PUT /api/notificacao/preferencias
 *   US-10: Configura canal (EMAIL | IN_APP | WEBHOOK) e frequência (IMEDIATA | DIARIA | SEMANAL).
 *   usuarioId resolvido do JWT (MVP P-25: 1 usuário por tenant).
 *   Autorização por objeto (P-51): chamadorId === usuarioId — verificada no use case.
 *   Retorna 200 PreferenciaDTO.
 *
 * Refs: docs/14 §4 (US-10), modules/notificacao, P-51.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { DefinirPreferenciasNotificacaoUseCase } from '@radar/notificacao';
import { UsuarioId } from '@radar/notificacao';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';

export interface NotificacaoContainer {
  definirPreferencias: DefinirPreferenciasNotificacaoUseCase;
}

const PreferenciasBodySchema = z.object({
  canais: z.array(z.string()).min(1),
  frequencia: z.string(),
}).strict();

export function criarNotificacaoRouter(container: NotificacaoContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);

  // PUT /preferencias — US-10 DefinirPreferenciasNotificacao
  router.put('/preferencias', async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let body: z.infer<typeof PreferenciasBodySchema>;
    try {
      const raw = await c.req.json();
      body = PreferenciasBodySchema.parse(raw);
    } catch {
      return c.json({ code: 'CORPO_INVALIDO', mensagem: 'Corpo inválido. Campos canais (array não-vazio) e frequencia (string) são obrigatórios.' }, 400);
    }

    // MVP P-25: 1 usuário por tenant — tenantId é o usuarioId neste estágio
    const usuarioId = UsuarioId(tenantId);

    try {
      const dto = await container.definirPreferencias.executar(
        {
          usuarioId,
          chamadorId: usuarioId,
          canais: body.canais,
          frequencia: body.frequencia,
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
