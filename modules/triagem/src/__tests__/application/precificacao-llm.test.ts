import { describe, expect, it } from 'vitest';
import { calcularCustoUsd, PRECOS_USD_POR_MILHAO_TOKENS } from '../../application/precificacao-llm.js';
import type { UsoLlm } from '../../application/ports.js';

function uso(over: Partial<UsoLlm> = {}): UsoLlm {
  return {
    modelo: 'claude-sonnet-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    transporte: 'on_demand',
    ...over,
  };
}

describe('calcularCustoUsd (RAD-230, P-20 — preços do veredicto RAD-227)', () => {
  it('Sonnet 5: 1M input + 1M output = $3 + $15 = $18', () => {
    const custo = calcularCustoUsd(uso({ modelo: 'claude-sonnet-5', inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(custo).toBeCloseTo(18, 6);
  });

  it('Opus 4.8: 1M input + 1M output = $5 + $25 = $30', () => {
    const custo = calcularCustoUsd(uso({ modelo: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(custo).toBeCloseTo(30, 6);
  });

  it('extração real pós-P-94 (~8k in / 3k out) no Sonnet ≈ R$0,38 do veredicto P-20 (em USD ≈ $0,069)', () => {
    const custo = calcularCustoUsd(uso({ modelo: 'claude-sonnet-5', inputTokens: 8000, outputTokens: 3000 }));
    // 8000/1e6 * 3 + 3000/1e6 * 15 = 0.024 + 0.045 = 0.069
    expect(custo).toBeCloseTo(0.069, 6);
  });

  it('modelo desconhecido usa o preço do tier mais caro (Opus) — nunca subestima', () => {
    const custoDesconhecido = calcularCustoUsd(uso({ modelo: 'modelo-futuro-inedito', inputTokens: 1000, outputTokens: 200 }));
    const custoOpus = calcularCustoUsd(uso({ modelo: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 200 }));
    expect(custoDesconhecido).toBeCloseTo(custoOpus, 9);
  });

  it('tokens de cache são cobrados como input base (P-95 ainda não precifica cache à parte)', () => {
    const semCache = calcularCustoUsd(uso({ modelo: 'claude-sonnet-5', inputTokens: 1000, outputTokens: 0 }));
    const comCacheRead = calcularCustoUsd(
      uso({ modelo: 'claude-sonnet-5', inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 500 }),
    );
    const precoInput = PRECOS_USD_POR_MILHAO_TOKENS['claude-sonnet-5']!.input;
    expect(comCacheRead - semCache).toBeCloseTo((500 / 1_000_000) * precoInput, 9);
  });

  it('zero tokens → custo zero', () => {
    expect(calcularCustoUsd(uso())).toBe(0);
  });
});

describe('calcularCustoUsd — desconto do transporte em LOTE (RAD-340, P-92/P-66)', () => {
  it('transporte "lote" custa exatamente a METADE do "on_demand" equivalente', () => {
    const base = { modelo: 'claude-sonnet-4-6', inputTokens: 8000, outputTokens: 3000 } as const;
    const onDemand = calcularCustoUsd(uso({ ...base, transporte: 'on_demand' }));
    const lote = calcularCustoUsd(uso({ ...base, transporte: 'lote' }));
    expect(lote).toBeCloseTo(onDemand * 0.5, 9);
  });

  it('fallback on-demand do Bedrock (grupo abaixo do mínimo) NÃO recebe desconto — preço cheio', () => {
    const custo = calcularCustoUsd(
      uso({ modelo: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000, transporte: 'on_demand' }),
    );
    // Mesmo preço cheio do Sonnet 4.6 (catálogo batch-capable, RAD-337): $3 + $15 = $18.
    expect(custo).toBeCloseTo(18, 6);
  });

  it('job de lote aplica −50% sobre o preço cheio do modelo batch-capable (Sonnet 4.6)', () => {
    const custo = calcularCustoUsd(
      uso({ modelo: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000, transporte: 'lote' }),
    );
    expect(custo).toBeCloseTo(9, 6); // ($3 + $15) × 0,5
  });
});
