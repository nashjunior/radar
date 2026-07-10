/**
 * Stubs in-memory de CriterioRepository, AlertaRepository, FaixaValorReferencia
 * e EventPublisher para o contexto Matching.
 *
 * Usados enquanto os adapters Postgres (RAD-76) não estão disponíveis.
 * A rota sobe e o contrato HTTP é verificável; a persistência é no-op.
 * Substituir aqui no composition root (server.ts) sem alterar use cases nem rotas.
 *
 * Limitation conhecida: faixaValorStub retorna [] — qualquer faixaValorCodigo
 * informado no POST /criterios resultará em CriterioInvalidoError (422) até
 * o adapter PostgresFaixaValorReferencia chegar via RAD-76.
 *
 * Refs: arquitetura/17 §4.3, RAD-76 (adapter de produção), RAD-77 (esta rota).
 */

import type {
  AlertaRepository,
  AuditCriterioPort,
  CriterioRepository,
  EditalCatalogoPort,
  EventPublisher,
  FaixaValorReferencia,
  MetricaMatchingRepository,
} from '@radar/matching';
import type { AlertaId, CriterioId } from '@radar/kernel';

export const criterioStub: CriterioRepository = {
  async salvar(_criterio, _signal) {
    /* sem persistência no stub */
  },
  async porId(_id: CriterioId, _signal: AbortSignal) {
    return null;
  },
  async listarAtivos(_signal: AbortSignal) {
    return [];
  },
  async listarPorTenant(_tenantId, _signal: AbortSignal) {
    return [];
  },
};

/** Stub de auditoria de critério — no-op em dev (sem trilha persistida). */
export const auditCriterioStub: AuditCriterioPort = {
  async registrar(_entrada, _signal) {
    /* no-op no stub */
  },
};

export const alertaStub: AlertaRepository = {
  async salvar(_alerta, _signal) {
    /* sem persistência no stub */
  },
  async porId(_id: AlertaId, _signal: AbortSignal) {
    return null;
  },
  async atualizarFeedback(_id: AlertaId, _relevante: boolean, _signal: AbortSignal) {
    /* sem persistência no stub */
  },
  async listarPorTenant(_tenantId, _signal: AbortSignal) {
    return [];
  },
};

export const faixaValorStub: FaixaValorReferencia = {
  async faixasVigentes(_data: Date, _signal: AbortSignal) {
    return [];
  },
};

export const eventPublisherStub: EventPublisher = {
  async publicar(_evento, _signal) {
    /* no-op no stub */
  },
};

export const systemClock = { agora: () => new Date() };

/** Stub do Catálogo cross-contexto — retorna null até adapter Postgres (RAD-76). */
export const editalCatalogoStub: EditalCatalogoPort = {
  async porId(_id, _signal: AbortSignal) {
    return null;
  },
};

export const metricaStub: MetricaMatchingRepository = {
  async precisao(_tenantId, _signal) {
    return { relevantes: 0, comFeedback: 0 };
  },
  async ativacao(_tenantId, _janelaEmDias, _signal) {
    return { ativados: 0, total: 0 };
  },
};
