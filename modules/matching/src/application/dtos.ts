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
}

/** Critério com score calculado pelo adapter. */
export interface CriterioComScore {
  criterio: CriterioDeMonitoramento;
  /** Score de aderência [0,1] calculado pelo adapter (SQL + full-text). */
  score: number;
}

export interface CriterioDTO {
  id: string;
  tenantId: string;
  clienteFinalId: string;
  ramoCnae: string | null;
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
    ramoCnae: c.ramoCnae,
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

export function alertaParaDTO(a: Alerta): AlertaDTO {
  return {
    id: a.id,
    tenantId: a.tenantId,
    clienteFinalId: a.clienteFinalId,
    criterioId: a.criterioId,
    editalId: a.editalId,
    aderencia: a.aderencia.valor,
    relevante: a.relevante,
  };
}
