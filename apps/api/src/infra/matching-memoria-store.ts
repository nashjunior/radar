/**
 * Persistência em memória de critérios, alertas, faixas e catálogo (demo local).
 */

import { createHash } from 'node:crypto';
import type { ContratacaoData } from '@radar/ingestao';
import {
  Alerta,
  CriterioDeMonitoramento,
  type AlertaRepository,
  type CriterioRepository,
  type EditalCatalogoPort,
  type EditalResumoParaMatchingDTO,
  type FaixaValorDTO,
  type FaixaValorReferencia,
  type MetricaMatchingRepository,
} from '@radar/matching';
import { AlertaId, CriterioId, EditalId, type TenantId } from '@radar/kernel';

export function editalIdDeNumeroControle(numeroControlePncp: string): EditalId {
  const hash = createHash('sha256').update(numeroControlePncp).digest('hex').slice(0, 32);
  return EditalId(hash);
}

export function criarCriterioMemoriaStore(): CriterioRepository {
  const map = new Map<string, CriterioDeMonitoramento>();

  return {
    async salvar(criterio, signal) {
      signal.throwIfAborted();
      // Demo: um critério ativo por tenant+cliente — desativa os anteriores.
      for (const [id, c] of map) {
        if (
          c.tenantId === criterio.tenantId &&
          c.clienteFinalId === criterio.clienteFinalId &&
          c.id !== criterio.id &&
          c.ativo
        ) {
          map.set(
            id,
            CriterioDeMonitoramento.reconstituir({
              id: c.id,
              tenantId: c.tenantId,
              clienteFinalId: c.clienteFinalId,
              ...(c.ramoCnae ? { ramoCnae: c.ramoCnae } : {}),
              ...(c.regiaoUf ? { regiaoUf: c.regiaoUf } : {}),
              ...(c.faixaValor ? { faixaValor: c.faixaValor } : {}),
              ...(c.palavrasChave ? { palavrasChave: c.palavrasChave } : {}),
              ativo: false,
            }),
          );
        }
      }
      map.set(criterio.id, criterio);
    },
    async porId(id, signal) {
      signal.throwIfAborted();
      return map.get(id) ?? null;
    },
    async listarAtivos(signal) {
      signal.throwIfAborted();
      return [...map.values()].filter((c) => c.ativo);
    },
    async listarPorTenant(tenantId, signal) {
      signal.throwIfAborted();
      return [...map.values()].filter((c) => c.tenantId === tenantId);
    },
  };
}

export function criarAlertaMemoriaStore(): AlertaRepository & {
  limparPorTenant(tenantId: TenantId): void;
  todos(): Alerta[];
} {
  const map = new Map<string, Alerta>();

  return {
    async salvar(alerta, signal) {
      signal.throwIfAborted();
      map.set(alerta.id, alerta);
    },
    async salvarEmLote(alertas, signal) {
      signal.throwIfAborted();
      for (const a of alertas) map.set(a.id, a);
    },
    async porId(id, signal) {
      signal.throwIfAborted();
      return map.get(id) ?? null;
    },
    async atualizarFeedback(id, relevante, signal) {
      signal.throwIfAborted();
      const atual = map.get(id);
      if (!atual) return;
      map.set(id, atual.comFeedback(relevante));
    },
    async listarPorTenant(tenantId, signal) {
      signal.throwIfAborted();
      return [...map.values()].filter((a) => a.tenantId === tenantId);
    },
    limparPorTenant(tenantId) {
      for (const [id, a] of map) {
        if (a.tenantId === tenantId) map.delete(id);
      }
    },
    todos() {
      return [...map.values()];
    },
  };
}

/** Faixas estáticas alinhadas à UI Configurar (Lei 14.133 arts. 75-76 — valores de referência). */
export function criarFaixaValorMemoria(): FaixaValorReferencia {
  const agora = new Date('2024-01-01T00:00:00Z');
  const faixas: FaixaValorDTO[] = [
    { codigo: 'MICRO_COMPRA', min: 0, max: 100_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'DISPENSA_SERVICOS', min: 0, max: 50_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'DISPENSA_OBRAS', min: 100_000, max: 500_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'CONVITE', min: 50_000, max: 250_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'TOMADA_PRECOS_SERV', min: 250_000, max: 1_430_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'TOMADA_PRECOS_OBRAS', min: 500_000, max: 3_300_000, vigenteDe: agora, vigenteAte: null },
    { codigo: 'CONCORRENCIA_SERV', min: 1_430_000, max: null, vigenteDe: agora, vigenteAte: null },
    { codigo: 'CONCORRENCIA_OBRAS', min: 3_300_000, max: null, vigenteDe: agora, vigenteAte: null },
  ];
  return {
    async faixasVigentes(_data, signal) {
      signal.throwIfAborted();
      return faixas;
    },
  };
}

export type CatalogoMemoria = EditalCatalogoPort & {
  sincronizarDoLote(lote: readonly ContratacaoData[]): void;
  tamanho(): number;
};

export function criarCatalogoMemoriaDoLote(): CatalogoMemoria {
  const map = new Map<string, EditalResumoParaMatchingDTO>();
  const numeroPorId = new Map<string, string>();

  return {
    sincronizarDoLote(lote) {
      map.clear();
      numeroPorId.clear();
      for (const ed of lote) {
        const id = editalIdDeNumeroControle(ed.numeroControlePncp);
        map.set(id, {
          modalidade: ed.modalidadeNome,
          titulo: ed.objeto,
          orgao: ed.orgao.nome,
          valorEstimado: ed.valorEstimado,
          dataAbertura: ed.prazoProposta?.toISOString() ?? ed.dataPublicacao.toISOString(),
        });
        numeroPorId.set(id, ed.numeroControlePncp);
      }
    },
    async porId(id, signal) {
      signal.throwIfAborted();
      return map.get(id) ?? null;
    },
    tamanho() {
      return map.size;
    },
  };
}

export function criarMetricaMemoria(alertas: AlertaRepository): MetricaMatchingRepository {
  return {
    async precisao(tenantId, signal) {
      const lista = await alertas.listarPorTenant(tenantId, signal);
      const comFeedback = lista.filter((a) => a.relevante !== null);
      const relevantes = comFeedback.filter((a) => a.relevante === true);
      return { relevantes: relevantes.length, comFeedback: comFeedback.length };
    },
    async ativacao(tenantId, _janela, signal) {
      const lista = await alertas.listarPorTenant(tenantId, signal);
      const total = lista.length > 0 ? 1 : 0;
      const ativados = lista.some((a) => a.relevante === true) ? 1 : 0;
      return { ativados, total };
    },
  };
}

export function novoAlertaId(): AlertaId {
  return AlertaId(crypto.randomUUID());
}

export function novoCriterioId(): CriterioId {
  return CriterioId(crypto.randomUUID());
}
