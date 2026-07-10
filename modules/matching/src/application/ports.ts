import type { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import type { Alerta } from '../domain/entities/alerta.js';
import type { CriterioDeMonitoramento } from '../domain/entities/criterio-de-monitoramento.js';
import type {
  EditalResumoParaMatchingDTO,
  FaixaValorDTO,
} from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Payload da fila interna de alertas (P-41/RAD-179)
// ---------------------------------------------------------------------------

/** Snapshot do alerta gerado — enfileirado para batch INSERT pelo ConsumidorAlertaBatch. */
export interface AlertaParaGravarPayload {
  readonly alertaId: AlertaId;
  readonly tenantId: TenantId;
  readonly clienteFinalId: ClienteFinalId;
  readonly criterioId: CriterioId;
  readonly editalId: EditalId;
  readonly aderencia: number;
}

// ---------------------------------------------------------------------------
// Ports de saída — nomenclatura por papel, adapter por tecnologia (A10 §8)
// ---------------------------------------------------------------------------

/** Repositório do agregado CriterioDeMonitoramento. */
export interface CriterioRepository {
  salvar(criterio: CriterioDeMonitoramento, signal: AbortSignal): Promise<void>;
  porId(id: CriterioId, signal: AbortSignal): Promise<CriterioDeMonitoramento | null>;
  /** Candidatos para o fan-out de matching (docs/13 §3). P-40: scan SQL no MVP; percolator no Next. */
  listarAtivos(signal: AbortSignal): Promise<CriterioDeMonitoramento[]>;
  /** Lista critérios ativos do tenant — usado para consulta autenticada com auditoria (P-61). */
  listarPorTenant(tenantId: TenantId, signal: AbortSignal): Promise<CriterioDeMonitoramento[]>;
}

/**
 * Criptografia de campo para estratégia comercial do cliente (docs/05 §9, P-59).
 * A application conhece o papel; algoritmo/chave ficam em infra.
 */
export interface FieldCryptoProvider {
  cifrarTexto(valor: string, contexto: string, signal: AbortSignal): Promise<string>;
  decifrarTexto(valor: string, contexto: string, signal: AbortSignal): Promise<string>;
}

/** Repositório do agregado Alerta. */
export interface AlertaRepository {
  salvar(alerta: Alerta, signal: AbortSignal): Promise<void>;
  /** Insere N alertas em uma única query (batch INSERT). ON CONFLICT DO NOTHING — idempotente. */
  salvarEmLote(alertas: Alerta[], signal: AbortSignal): Promise<void>;
  porId(id: AlertaId, signal: AbortSignal): Promise<Alerta | null>;
  atualizarFeedback(
    id: AlertaId,
    relevante: boolean,
    signal: AbortSignal,
  ): Promise<void>;
  listarPorTenant(tenantId: TenantId, signal: AbortSignal): Promise<Alerta[]>;
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

/**
 * Fila interna de alertas a gravar — buffer para batch INSERT (P-41/RAD-179).
 * Adapter SQS na produção; FilaAlertaMemoria nos testes.
 * `drenar` retorna até `limite` itens; array vazio indica fila vazia.
 */
export interface FilaAlertaPort {
  enfileirar(alerta: AlertaParaGravarPayload, signal: AbortSignal): Promise<void>;
  drenar(limite: number, signal: AbortSignal): Promise<AlertaParaGravarPayload[]>;
}

/** Gera CriterioIds únicos. Injetado na infra — construtores de ID ficam fora da application. */
export interface CriterioIdProvider {
  gerar(): CriterioId;
}

/** Gera AlertaIds únicos. Injetado na infra — construtores de ID ficam fora da application. */
export interface AlertaIdProvider {
  gerar(): AlertaId;
}

/**
 * Gateway cross-contexto para o Catálogo (Ingestão) — lê resumo de edital por ID.
 * Implementado na infra por adapter Postgres ou HTTP; stub retorna null no MVP.
 * P-40: MVP aceita N+1 lookups; no Next substituir por view SQL alerta_com_edital.
 */
export interface EditalCatalogoPort {
  porId(id: EditalId, signal: AbortSignal): Promise<EditalResumoParaMatchingDTO | null>;
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

// ---------------------------------------------------------------------------
// Auditoria de classe crítica (docs/05 §9, P-61, AB13)
// ---------------------------------------------------------------------------

/** Dados mínimos de um evento auditável sobre CRITERIO_MONITORAMENTO. */
export interface AuditCriterioEntrada {
  readonly operadorId: string;
  readonly recurso: string;
  readonly acao: string;
  readonly baseLegal: string;
  readonly escopo: {
    readonly tenantId: TenantId;
    readonly clienteFinalId?: ClienteFinalId;
  };
}

/**
 * Port de auditoria append-only para operações sobre CRITERIO_MONITORAMENTO.
 * Fail-closed (AB13/P-61): a implementação deve lançar em caso de falha de gravação.
 * Adaptada na infra para o AuditLogRepository de @radar/governanca.
 */
export interface AuditCriterioPort {
  registrar(entrada: AuditCriterioEntrada, signal: AbortSignal): Promise<void>;
}
