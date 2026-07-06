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
  CriterioRepository,
  EventPublisher,
  FaixaValorReferencia,
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
  async casarComEdital(_edital, _signal: AbortSignal) {
    return [];
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
