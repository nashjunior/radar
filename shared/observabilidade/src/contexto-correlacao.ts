import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambiente do trace corrente (A18 §3.3) — lido só pela infra (logger e
 * publisher). Nenhum use case recebe ou repassa `correlationId`: quem entra
 * no escopo (middleware HTTP na borda da API, consumidor de fila no worker)
 * é sempre código de infra.
 */
const armazenamento = new AsyncLocalStorage<string>();

/** Roda `fn` com `correlationId` disponível para todo `criarLogger`/`envelopar` chamado dentro. */
export function comCorrelacao<T>(correlationId: string, fn: () => T): T {
  return armazenamento.run(correlationId, fn);
}

/** `undefined` fora de qualquer escopo de requisição/mensagem (ex.: log de boot). */
export function correlationIdAtual(): string | undefined {
  return armazenamento.getStore();
}
