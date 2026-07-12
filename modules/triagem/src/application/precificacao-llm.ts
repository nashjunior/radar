import type { UsoLlm } from './ports.js';

/**
 * Preços USD por MILHÃO de tokens (input/output) — fonte: catálogo verificado no veredicto de
 * arquitetura de P-20 (docs/98, Eng/Artur, RAD-227, 2026-07-11). Fonte única do contexto (como
 * `CATEGORIAS`/`SEVERIDADES` em `anthropic-extracao-schema.ts`) — atualizar aqui quando o catálogo mudar.
 *
 * Tokens de CACHE (P-95) ainda não são precificados à parte: hoje `paramsExtracao` não seta
 * `cache_control`, então `cacheReadInputTokens`/`cacheCreationInputTokens` chegam zerados na
 * prática. Quando P-95 ligar o cache, os multiplicadores reais (leitura mais barata, escrita mais
 * cara que o input base) entram nesta tabela — não decidido ainda (nuance de retorno decrescente
 * já sinalizada no veredicto P-20); até lá, tokens de cache são cobrados como input base.
 */
export const PRECOS_USD_POR_MILHAO_TOKENS: Readonly<Record<string, { input: number; output: number }>> = {
  // Geração da API 1P / router síncrono atual (`escolherModelo`).
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
  // Geração batch-capable do Bedrock (P-66/P-93/RAD-231): a matriz de batch inference cobre
  // Haiku 4.5 / Sonnet 4.6 / Opus 4.5-4.6 — Sonnet 5 e Opus 4.8 NÃO estão nela. Sem estas
  // entradas, a pré-extração EM LOTE de produção caía no fallback de Opus (`PRECO_DESCONHECIDO`),
  // apagando a diferença de custo por tier no ledger (achado da RAD-337). Preços de catálogo
  // (list 1P, ON-DEMAND) — o −50% do transporte batch (RAD-340) é aplicado embaixo, sobre este
  // preço cheio, só quando `uso.transporte === 'lote'`.
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
};

/** Modelo fora do catálogo → preço do tier mais caro (Opus), para nunca SUBESTIMAR custo real. */
const PRECO_DESCONHECIDO = PRECOS_USD_POR_MILHAO_TOKENS['claude-opus-4-8']!;

/**
 * Desconto do transporte em LOTE (RAD-54 · Lever 1 de RAD-53, P-92/P-66) — batch inference é −50%
 * do preço on-demand, tanto na Message Batches API da Anthropic quanto no `CreateModelInvocationJob`
 * do Bedrock. NÃO é aplicado quando `BedrockBatchLlmGateway` cai no fallback on-demand (grupo abaixo
 * do mínimo de registros do job) — por isso o desconto mora aqui, condicionado a `uso.transporte`,
 * nunca como um ×0,5 solto no caller (achado da RAD-340).
 */
const FATOR_DESCONTO_LOTE = 0.5;

/**
 * Custo em USD de UMA chamada ao LLM — fato a gravar no `UsoLlmLedger` (RAD-230). Pura: sem I/O,
 * mesma classe de função que `politica-confianca.ts`. Conversão a BRL fica no relatório/leitura,
 * nunca aqui (risco de câmbio, docs/09 §6.4) — o ledger grava o fato na moeda de cobrança (P-66).
 */
export function calcularCustoUsd(uso: UsoLlm): number {
  const preco = PRECOS_USD_POR_MILHAO_TOKENS[uso.modelo] ?? PRECO_DESCONHECIDO;
  const tokensCache = uso.cacheReadInputTokens + uso.cacheCreationInputTokens;
  const custoInput = ((uso.inputTokens + tokensCache) / 1_000_000) * preco.input;
  const custoOutput = (uso.outputTokens / 1_000_000) * preco.output;
  const custoCheio = custoInput + custoOutput;
  return uso.transporte === 'lote' ? custoCheio * FATOR_DESCONTO_LOTE : custoCheio;
}
