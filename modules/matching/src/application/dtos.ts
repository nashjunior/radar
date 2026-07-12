import type { EditalId } from '@radar/kernel';
import type { Alerta } from '../domain/entities/alerta.js';
import type { CriterioDeMonitoramento } from '../domain/entities/criterio-de-monitoramento.js';

/** Visão mínima do Catálogo que o Matching precisa para cruzar. */
export interface EditalParaMatchingDTO {
  id: EditalId;
  /** Catálogo é global no MVP (A03 §4) — sem scoping por tenant na leitura. */
  tenantScope: 'global';
  modalidadeCodigo: number;
  objetoDescricao: string;
  uf: string | null;
  cnae: string | null;
  valorEstimado: number | null;
  dataPublicacao: Date;
  /** Prazo final para envio de propostas — usado no cálculo de criticidade (P-81, RAD-303). */
  prazoProposta: Date | null;
  /** Proveniência do edital, disponível quando presente no evento edital.ingerido (RAD-115). */
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
}

export interface CriterioDTO {
  id: string;
  tenantId: string;
  clienteFinalId: string;
  regiaoUf: string | null;
  faixaValorMin: number | null;
  faixaValorMax: number | null;
  palavrasChave: string[];
  ativo: boolean;
}

export interface AlertaDTO {
  id: string;
  tenantId: string;
  clienteFinalId: string;
  criterioId: string;
  editalId: string;
  aderencia: number;
  relevante: boolean | null;
  /** aderência alta OU prazo crítico (P-81, A18 §5.1) — decidido no domínio, não no worker. */
  imediato: boolean;
  /** Proveniência do edital — presente quando disponível no evento de ingestão (RAD-115). */
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
  /** Campos enriquecidos do Catálogo (RAD-148). Ausentes quando o edital não for encontrado. */
  modalidade?: string;
  titulo?: string;
  orgao?: string;
  valorEstimado?: number | null;
  /** ISO string — mapeado de prazoProposta do edital (data-limite para propostas). */
  dataAbertura?: string;
}

/** Resumo de edital vindo do Catálogo para enriquecer alertas (RAD-148). */
export interface EditalResumoParaMatchingDTO {
  modalidade: string;
  titulo: string;
  orgao: string;
  valorEstimado: number | null;
  /** ISO string — de prazoProposta. */
  dataAbertura: string;
}

export interface FaixaValorDTO {
  codigo: string;
  min: number | null;
  max: number | null;
  vigenteDe: Date;
  vigenteAte: Date | null;
}

export function criterioParaDTO(c: CriterioDeMonitoramento): CriterioDTO {
  return {
    id: c.id,
    tenantId: c.tenantId,
    clienteFinalId: c.clienteFinalId,
    regiaoUf: c.regiaoUf,
    faixaValorMin: c.faixaValor?.min ?? null,
    faixaValorMax: c.faixaValor?.max ?? null,
    palavrasChave: c.palavrasChave?.termos.slice() ?? [],
    ativo: c.ativo,
  };
}

/** Snapshot de métricas de qualidade do matching para um tenant (docs/08 §3, P-14). */
export interface MetricasMatchingDTO {
  /** Ratio de alertas marcados relevantes / total com feedback. null se ainda não há feedback. */
  precisao: number | null;
  /** Alvo de precisão: 60% (docs/08 §3). */
  precisaoAlvo: number;
  /** Ratio de clientes com ≥1 alerta relevante na janela / total com ≥1 alerta na janela. null se sem dados. */
  ativacao: number | null;
  /** Alvo de ativação: 50% (docs/08 §3). */
  ativacaoAlvo: number;
  /** Janela de ativação em dias usada no cálculo. */
  janelaEmDias: number;
}

/**
 * Resultado de um ciclo do reconciliador de prazo crítico (docs/08 §4.1, A18 §5.1, RAD-303).
 * `perdido` é o déficit — a métrica do SLO de error budget zero.
 */
export interface PrazoCriticoReconciliacaoDTO {
  elegivel: number;
  coberto: number;
  perdido: number;
}

export function alertaParaDTO(
  a: Alerta,
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string },
): AlertaDTO {
  return {
    id: a.id,
    tenantId: a.tenantId,
    clienteFinalId: a.clienteFinalId,
    criterioId: a.criterioId,
    editalId: a.editalId,
    aderencia: a.aderencia.valor,
    relevante: a.relevante,
    imediato: a.imediato,
    ...(proveniencia !== undefined ? { proveniencia } : {}),
  };
}
