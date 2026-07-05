/**
 * Rota: GET /api/triagem/:editalId
 *
 * Retorna o resultado de triagem de um edital para o perfil do tenant.
 * Semântica que a SPA (TriagemHttpGateway) já trata:
 *   - 200  → triagem encontrada
 *   - 404  → sem triagem para este edital/perfil
 *   - 403  → authz por objeto falhou — nunca vazar cross-tenant (A17 §5.3)
 *
 * AbortSignal derivado do request propaga cancelamento ao use case.
 *
 * BLOQUEADO EM: RAD-30 (modules/triagem) — ConsultarTriagem use case não
 * existe ainda. A rota está scaffolded com contrato completo; descomente
 * o bloco de injeção quando RAD-30 for concluído.
 *
 * Refs: docs/98 P-86, arquitetura/17 §5.3, apps/web/infra/api/triagem-http-gateway.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { EditalId } from '@radar/kernel';
import { responderErro } from '../errors.js';
import { tenantMiddleware } from '../middleware/tenant.js';

// Contrato de saída — espelhado no TriagemHttpGateway do frontend
const TriagemResponseSchema = z.object({
  editalId: z.string(),
  perfilId: z.string(),
  aderencia: z.number().min(0).max(100),
  recomendacao: z.enum(['go', 'no-go']),
  confiancaIA: z.number().min(0).max(100),
  paginasEdital: z.number().int().nonnegative(),
  camposAnalise: z.array(
    z.object({
      titulo: z.string(),
      conteudo: z.string(),
      fonte: z.string(),
    }),
  ),
  checklist: z.array(
    z.object({
      ok: z.boolean(),
      texto: z.string(),
    }),
  ),
});

export type TriagemResponse = z.infer<typeof TriagemResponseSchema>;

export function criarTriagemRouter(/* container: AppContainer */): Hono {
  const router = new Hono();

  router.use('/*', tenantMiddleware);

  router.get('/:editalId', async (c) => {
    const editalIdRaw = c.req.param('editalId');
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let editalId: ReturnType<typeof EditalId>;
    try {
      editalId = EditalId(editalIdRaw);
    } catch {
      return c.json({ code: 'EDITAL_ID_INVALIDO', mensagem: 'editalId inválido.' }, 400);
    }

    try {
      // TODO (RAD-30): descomente quando ConsultarTriagemUseCase estiver disponível
      //
      // const resultado = await container.consultarTriagem.executar(
      //   { tenantId, editalId },
      //   signal,
      // );
      //
      // if (!resultado) return c.json({}, 404);
      //
      // const payload: TriagemResponse = {
      //   editalId: resultado.editalId,
      //   perfilId: resultado.perfilId,
      //   aderencia: resultado.aderencia,
      //   recomendacao: resultado.recomendacao,
      //   confiancaIA: resultado.confiancaIA,
      //   paginasEdital: resultado.paginasEdital,
      //   camposAnalise: resultado.camposAnalise,
      //   checklist: resultado.checklist,
      // };
      //
      // return c.json(payload);

      // Placeholder até RAD-30 ser concluído — retorna 503 para não confundir com 404
      void editalId;
      void tenantId;
      void signal;
      return c.json(
        {
          code: 'SERVICO_INDISPONIVEL',
          mensagem: 'Módulo de triagem ainda não implementado (RAD-30 pendente).',
        },
        503,
      );
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
