import type { AlertaId, CriterioId, TenantId } from '@radar/kernel';
import type { Alerta } from '../domain/entities/alerta.js';
import type { CriterioDeMonitoramento } from '../domain/entities/criterio-de-monitoramento.js';
import type {
  CriterioComScore,
  EditalParaMatchingDTO,
  FaixaValorDTO,
} from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Ports de saída — nomenclatura por papel, adapter por tecnologia (A10 §8)
// ---------------------------------------------------------------------------

/** Repositório do agregado CriterioDeMonitoramento. */
export interface CriterioRepository {
  salvar(criterio: CriterioDeMonitoramento, signal: AbortSignal): Promise<void>;
  porId(id: CriterioId, signal: AbortSignal): Promise<CriterioDeMonitoramento | null>;
  listarAtivos(signal: AbortSignal): Promise<CriterioDeMonitoramento[]>;
  /**
   * Fan-out edital × critérios ativos, retorna critérios com score.
   * P-40: no MVP scan SQL; no Next, percolator (índice invertido de critérios).
   */
  casarComEdital(
    edital: EditalParaMatchingDTO,
    signal: AbortSignal,
  ): Promise<CriterioComScore[]>;
}

/** Repositório do agregado Alerta. */
export interface AlertaRepository {
  salvar(alerta: Alerta, signal: AbortSignal): Promise<void>;
  porId(id: AlertaId, signal: AbortSignal): Promise<Alerta | null>;
  atualizarFeedback(
    id: AlertaId,
    relevante: boolean,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * Faixas de valor vigentes lidas de tabela parametrizável e datada (docs/02 §2).
 * Nunca um enum ou constante no código.
 */
export interface FaixaValorReferencia {
  faixasVigentes(data: Date, signal: AbortSignal): Promise<FaixaValorDTO[]>;
}

/** Publicação de eventos de domínio na fila (Published Language — A03 §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/** Gera CriterioIds únicos. Injetado na infra — construtores de ID ficam fora da application. */
export interface CriterioIdProvider {
  gerar(): CriterioId;
}

/** Gera AlertaIds únicos. Injetado na infra — construtores de ID ficam fora da application. */
export interface AlertaIdProvider {
  gerar(): AlertaId;
}

/** Provedor da data/hora atual. Injetado na infra para testabilidade. */
export interface ClockProvider {
  agora(): Date;
}

/**
 * Consulta agregados de métricas de qualidade do matching (P-14, P-15, docs/08 §3).
 * Somente leitura — não altera estado. Implementado na infra via SQL sobre alertas + feedbacks.
 */
export interface MetricaMatchingRepository {
  /**
   * Precisão: alertas marcados relevantes / total de alertas com feedback, por tenant.
   * Retorna contagens brutas para cálculo do ratio na camada de aplicação.
   */
  precisao(
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<{ relevantes: number; comFeedback: number }>;

  /**
   * Ativação: clientes que receberam ≥1 alerta relevante dentro da janela / total de clientes
   * com ≥1 alerta gerado na mesma janela (docs/08 §3 — meta ≥50%).
   */
  ativacao(
    tenantId: TenantId,
    janelaEmDias: number,
    signal: AbortSignal,
  ): Promise<{ ativados: number; total: number }>;
}
