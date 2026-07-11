import type { ExtracaoEdital } from './extracao-edital.js';

/**
 * Decisão compartilhada entre `ExtrairEditalUseCase` (síncrono) e `ExtrairEditaisEmLoteUseCase`
 * (RAD-186): cache-hit por edital (P-45) e piso de OCR (docs/10 §6). Cada use case mantém o
 * PRÓPRIO desfecho em cima do resultado — throw vs. contador+continue.
 */
export type ElegibilidadeExtracao =
  | { readonly tipo: 'cache_hit'; readonly extracao: ExtracaoEdital }
  | { readonly tipo: 'sem_texto' }
  | { readonly tipo: 'elegivel' };

/**
 * Cache-hit: extração já existe → não re-chama o LLM (guardrail de custo, docs/10 §7 / P-20).
 * Sem cache-hit, sem texto após OCR → leitura manual (docs/10 §6).
 */
export function avaliarElegibilidadeExtracao(
  existente: ExtracaoEdital | null,
  texto: string,
  temTextoSelecionavel: boolean,
): ElegibilidadeExtracao {
  if (existente !== null) return { tipo: 'cache_hit', extracao: existente };
  if (!temTextoSelecionavel && texto.trim().length === 0) return { tipo: 'sem_texto' };
  return { tipo: 'elegivel' };
}
