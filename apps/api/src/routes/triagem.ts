/**
 * Rotas: GET /api/triagem/:editalId  e  POST /api/triagem/:editalId/solicitar
 *
 * GET  → lê o resultado de triagem (ou estado de ciclo de vida: processando/falha_ocr/…)
 * POST → dispara a triagem pull (US-07): persiste estado `processando` + publica triagem.solicitada
 *
 * Semântica HTTP:
 *   GET  200 → triagem/estado encontrado   404 → nunca solicitada   403 → authz por objeto
 *   POST 202 → enfileirado (idempotente)   403 → authz por objeto   404 → tenant desconhecido
 *
 * AbortSignal derivado do request propaga cancelamento ao use case.
 *
 * RBAC (P-52, docs/05 §4): TRIAGEM ler (GET); TRIAGEM criar (solicitar);
 * TRIAGEM decidir (aceitar/contestar/decisao).
 *
 * Refs: docs/98 P-86, arquitetura/17 §4.3/§5.3, apps/web/infra/api/triagem-http-gateway.ts, P-52
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { EditalId } from '@radar/kernel';
import type {
  ConsultarTriagemUseCase,
  RegistrarFeedbackTriagemUseCase,
  SolicitarTriagemUseCase,
} from '@radar/triagem';
import { responderErro } from '../errors.js';
import { autenticarMiddleware } from '../middleware/tenant.js';
import { rateLimitPorTenantMiddleware } from '../security.js';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';
import type { AutorizarMiddleware } from '../middleware/autorizacao.js';

export interface TriagemContainer {
  consultarTriagem: ConsultarTriagemUseCase;
  solicitarTriagem: SolicitarTriagemUseCase;
  registrarFeedback: RegistrarFeedbackTriagemUseCase;
  perfilAtivo: PerfilAtivoGateway;
  autorizar: AutorizarMiddleware;
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

const ContestacaoBodySchema = z.object({
  motivo: z.string().nullable().optional(),
}).strict();

const DecisaoBodySchema = z.object({
  go: z.boolean(),
}).strict();

export type TriagemResponse = z.infer<typeof TriagemResponseSchema>;

export function criarTriagemRouter(container: TriagemContainer): Hono {
  const router = new Hono();

  router.use('/*', autenticarMiddleware);
  router.use('/*', rateLimitPorTenantMiddleware);

  // GET /:editalId — RBAC: TRIAGEM ler
  router.get('/:editalId', container.autorizar('TRIAGEM', 'ler'), async (c) => {
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

  // POST /:editalId/solicitar — US-07 pull trigger (RAD-80) — RBAC: TRIAGEM criar
  router.post('/:editalId/solicitar', container.autorizar('TRIAGEM', 'criar'), async (c) => {
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
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const { perfilId, clienteFinalId } = perfil;
      await container.solicitarTriagem.executar(
        { tenantId, editalId, perfilId, clienteFinalId },
        signal,
      );

      return c.json({ editalId, estado: 'processando' as const }, 202);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // POST /:editalId/aceitar — UTI1: usuário aceita a análise (RAD-81) — RBAC: TRIAGEM decidir
  router.post('/:editalId/aceitar', container.autorizar('TRIAGEM', 'decidir'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let editalId: ReturnType<typeof EditalId>;
    try { editalId = EditalId(c.req.param('editalId')); } catch {
      return c.json({ code: 'EDITAL_ID_INVALIDO', mensagem: 'editalId inválido.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      await container.registrarFeedback.executar(
        { tipo: 'aceita', tenantId, editalId, perfilId: perfil.perfilId, clienteFinalId: perfil.clienteFinalId },
        signal,
      );
      return c.json({ ok: true }, 202);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // POST /:editalId/contestar — UTI1: usuário contesta a análise (RAD-81) — RBAC: TRIAGEM decidir
  router.post('/:editalId/contestar', container.autorizar('TRIAGEM', 'decidir'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let editalId: ReturnType<typeof EditalId>;
    try { editalId = EditalId(c.req.param('editalId')); } catch {
      return c.json({ code: 'EDITAL_ID_INVALIDO', mensagem: 'editalId inválido.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const parsed = ContestacaoBodySchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) {
        return c.json({ code: 'CORPO_INVALIDO', mensagem: 'Campo "motivo" deve ser string ou null quando informado.' }, 400);
      }

      await container.registrarFeedback.executar(
        {
          tipo: 'contestada',
          tenantId, editalId,
          perfilId: perfil.perfilId,
          clienteFinalId: perfil.clienteFinalId,
          motivo: parsed.data.motivo ?? null,
        },
        signal,
      );
      return c.json({ ok: true }, 202);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  // POST /:editalId/decisao — UTI2: usuário registra decisão go/no-go (RAD-81) — RBAC: TRIAGEM decidir
  router.post('/:editalId/decisao', container.autorizar('TRIAGEM', 'decidir'), async (c) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    let editalId: ReturnType<typeof EditalId>;
    try { editalId = EditalId(c.req.param('editalId')); } catch {
      return c.json({ code: 'EDITAL_ID_INVALIDO', mensagem: 'editalId inválido.' }, 400);
    }

    try {
      const perfil = await container.perfilAtivo.resolverParaTenant(tenantId, signal);
      if (!perfil) return c.json({}, 404);

      const parsed = DecisaoBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ code: 'CORPO_INVALIDO', mensagem: 'Campo "go" (boolean) obrigatório.' }, 400);
      }

      await container.registrarFeedback.executar(
        {
          tipo: 'decisao',
          tenantId, editalId,
          perfilId: perfil.perfilId,
          clienteFinalId: perfil.clienteFinalId,
          go: parsed.data.go,
        },
        signal,
      );
      return c.json({ ok: true }, 202);
    } catch (err) {
      return responderErro(c, err);
    }
  });

  return router;
}
