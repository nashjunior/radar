import { randomBytes } from 'node:crypto';

/**
 * Formato estrito do header `traceparent` (W3C Trace Context):
 * `version-trace_id-parent_id-trace_flags`, todos hex minúsculo.
 */
const TRACEPARENT_REGEX = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const TRACE_ID_REGEX = /^[0-9a-f]{32}$/;
const TRACE_ID_ZERADO = '0'.repeat(32);

/** Gera um trace-id novo (32 hex minúsculo) — W3C Trace Context §3.1. */
export function gerarTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Um trace-id de 32 hex minúsculo, não-zerado — a mesma regra usada para validar `correlationId` recebido de fora. */
export function traceIdValido(id: string): boolean {
  return TRACE_ID_REGEX.test(id) && id !== TRACE_ID_ZERADO;
}

/**
 * Extrai o trace-id do header `traceparent` do cliente (A18 §3.1). Header de
 * cliente é dado não confiável — só aceito se casar com a regex estrita do
 * formato; qualquer outra coisa (ausente, malformado, trace-id zerado) é
 * descartada **sem nunca ecoar o valor recebido** (vetor de log forging) e um
 * trace novo é gerado.
 */
export function extrairOuGerarTraceId(traceparent: string | undefined | null): string {
  if (typeof traceparent === 'string') {
    const traceId = TRACEPARENT_REGEX.exec(traceparent)?.[1];
    if (traceId && traceIdValido(traceId)) return traceId;
  }
  return gerarTraceId();
}
