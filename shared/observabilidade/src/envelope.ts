import { correlationIdAtual } from './contexto-correlacao.js';
import { gerarTraceId, traceIdValido } from './trace-context.js';

/**
 * O que a fila carrega de fato (infra) — não o que o domínio conhece (A18
 * §3.2). `correlationId` é metadado de transporte: não entra no `DomainEvent`
 * do kernel, não polui os 22 construtores de evento.
 */
export interface EnvelopeDeEvento {
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: unknown;
  readonly correlationId: string;
}

/** Publisher (infra): estampa o `correlationId` do `AsyncLocalStorage` corrente antes de publicar. */
export function envelopar(evento: { type: string; occurredAt: string; payload: unknown }): EnvelopeDeEvento {
  return {
    ...evento,
    correlationId: correlationIdAtual() ?? gerarTraceId(),
  };
}

export interface CorrelationIdDoEnvelope {
  readonly correlationId: string;
  /** `true` quando o envelope não trazia um `correlationId` válido — o call site decide se loga a lacuna. */
  readonly gerado: boolean;
}

/**
 * Consumidor (infra): lê o `correlationId` do envelope recebido e re-entra no
 * contexto antes de chamar o use case — é isso que faz o log do worker casar
 * com o log da API. Aditivo/não-breaking: envelope sem `correlationId` (ou
 * com um valor fora do formato W3C) não derruba o consumo — gera um novo.
 */
export function correlationIdDoEnvelope(envelope: { correlationId?: string | undefined }): CorrelationIdDoEnvelope {
  const recebido = envelope.correlationId;
  if (typeof recebido === 'string' && traceIdValido(recebido)) {
    return { correlationId: recebido, gerado: false };
  }
  return { correlationId: gerarTraceId(), gerado: true };
}
