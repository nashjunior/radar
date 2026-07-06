/**
 * Rota: GET /api/triagem/:editalId
 *
 * Retorna o resultado de triagem de um edital para o perfil do tenant.
 * Semântica que a SPA (TriagemHttpGateway) já trata:
 *   - 200  → triagem encontrada
 *   - 404  → sem triagem para este edital/perfil (ou tenant desconhecido no TENANT_SEED)
 *   - 403  → authz por objeto falhou — nunca vazar cross-tenant (A17 §5.3)
 *
 * AbortSignal derivado do request propaga cancelamento ao use case.
 *
 * Refs: docs/98 P-86, arquitetura/17 §5.3, apps/web/infra/api/triagem-http-gateway.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { EditalId } from '@radar/kernel';
import type { ConsultarTriagemUseCase } from '@radar/triagem';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';

const TRIAGEM_STATUS = ['processando', 'concluida', 'incompleta', 'falha_ocr', 'recusada'] as const;

export interface TriagemContainer {
  consultarTriagem: ConsultarTriagemUseCase;
  perfilAtivo: PerfilAtivoGateway;
}

/**
 * Contrato de saída — espelhado no TriagemHttpGateway do frontend (RAD-79).
 * Todos os status incluem `status`; campos de leitura presentes só em `concluida`/`incompleta`.
 */
const CampoAnaliseSchema = z.object({
  titulo: z.string(),
  conteudo: z.string(),
  fonte: z.string(),
  estado: z.enum(['ok', 'verificar']),
});

const TriagemDadosSchema = z.object({
  editalId: z.string(),
  perfilId: z.string(),
  aderencia: z.number().min(0).max(1),
  recomendacao: z.enum(['go', 'no-go']),
  confiancaIA: z.number().min(0).max(1),
  paginasEdital: z.number().int().nonnegative(),
  camposAnalise: z.array(CampoAnaliseSchema),
  checklist: z.array(z.object({ ok: z.boolean(), texto: z.string() })),
});

const TriagemResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('processando') }),
  z.object({ status: z.literal('falha_ocr') }),
  z.object({ status: z.literal('recusada') }),
  TriagemDadosSchema.extend({ status: z.literal('concluida') }),
  TriagemDadosSchema.extend({ status: z.literal('incompleta') }),
]);

export type TriagemResponse = z.infer<typeof TriagemResponseSchema>;

export function criarTriagemRouter(container: TriagemContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);

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
      // Seam P-90: BFF resolve perfil ativo do tenant (PerfilAtivoConfigAdapter, docs/98 P-90).
      // MVP single-tenant (P-25): 1 tenantId → 1 clienteFinalId → 1 perfilId via TENANT_SEED.
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const { perfilId, clienteFinalId } = perfil;
      const resultado = await container.consultarTriagem.executar(
        { tenantId, editalId, perfilId, clienteFinalId },
        signal,
      );

      if (!resultado) return c.json({}, 404);

      const payload: TriagemResponse = resultado.status === 'concluida' || resultado.status === 'incompleta'
        ? {
            status: resultado.status,
            editalId: resultado.editalId,
            perfilId: resultado.perfilId,
            aderencia: resultado.aderencia,
            recomendacao: resultado.recomendacao,
            confiancaIA: resultado.confiancaIA,
            paginasEdital: resultado.paginasEdital,
            camposAnalise: resultado.camposAnalise,
            checklist: resultado.checklist,
          }
        : { status: resultado.status };

      return c.json(payload);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
