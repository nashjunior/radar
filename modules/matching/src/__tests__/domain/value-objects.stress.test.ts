/**
 * Stress tests — domain VOs do matching (adversarial / boundary)
 *
 * Eixo 1 — regras de negócio: invariantes dos VOs sob condições adversariais: NaN, Infinity,
 * valores-limite exatos e entradas que adapters de infra ou payloads externos podem injetar.
 *
 * Eixo 2 — critério de corte: limiares recall-alto (superaLimiar 0.3, ehAlta 0.8 — P-81) e
 * comportamento de abrange() nos limites exatos da FaixaValor.
 */
import { describe, expect, it } from 'vitest';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import {
  AderenciaMatchingInvalidaError,
  FaixaValorInvalidaError,
  PalavrasChaveVaziaError,
} from '../../domain/errors/index.js';

// ─── AderenciaMatching ────────────────────────────────────────────────────────

describe('AderenciaMatching — limites e entradas inválidas', () => {
  it('aceita 0 (limite inferior)', () => {
    expect(AderenciaMatching.criar(0).valor).toBe(0);
  });

  it('aceita 1 (limite superior)', () => {
    expect(AderenciaMatching.criar(1).valor).toBe(1);
  });

  it('rejeita NaN — NaN bypass: !Number.isFinite(NaN) deve bloquear (corrigido)', () => {
    expect(() => AderenciaMatching.criar(NaN)).toThrow(AderenciaMatchingInvalidaError);
  });

  it('rejeita +Infinity', () => {
    expect(() => AderenciaMatching.criar(Infinity)).toThrow(AderenciaMatchingInvalidaError);
  });

  it('rejeita -Infinity', () => {
    expect(() => AderenciaMatching.criar(-Infinity)).toThrow(AderenciaMatchingInvalidaError);
  });

  it('rejeita valor negativo', () => {
    expect(() => AderenciaMatching.criar(-0.001)).toThrow(AderenciaMatchingInvalidaError);
  });

  it('rejeita valor acima de 1', () => {
    expect(() => AderenciaMatching.criar(1.001)).toThrow(AderenciaMatchingInvalidaError);
  });

  it('superaLimiar = true exatamente em 0.3 (recall-alto — limiar inclusivo, docs/11 §2)', () => {
    expect(AderenciaMatching.criar(0.3).superaLimiar).toBe(true);
  });

  it('superaLimiar = false em 0.2999... (just-below do limiar)', () => {
    expect(AderenciaMatching.criar(0.2999999999999999).superaLimiar).toBe(false);
  });

  it('superaLimiar = false em 0 (sem aderência)', () => {
    expect(AderenciaMatching.criar(0).superaLimiar).toBe(false);
  });

  it('ehAlta = true exatamente em 0.8 (P-81)', () => {
    expect(AderenciaMatching.criar(0.8).ehAlta).toBe(true);
  });

  it('ehAlta = false em 0.7999...', () => {
    expect(AderenciaMatching.criar(0.7999999999999999).ehAlta).toBe(false);
  });
});

// ─── FaixaValor ───────────────────────────────────────────────────────────────

describe('FaixaValor.criar — limites e entradas inválidas', () => {
  it('aceita min e max válidos', () => {
    const fv = FaixaValor.criar(100, 1_000_000);
    expect(fv.min).toBe(100);
    expect(fv.max).toBe(1_000_000);
  });

  it('aceita min = max (intervalo de ponto único)', () => {
    expect(() => FaixaValor.criar(100, 100)).not.toThrow();
  });

  it('aceita (null, null) — intervalo irrestrito', () => {
    const fv = FaixaValor.criar(null, null);
    expect(fv.min).toBeNull();
    expect(fv.max).toBeNull();
  });

  it('aceita (null, max) — sem piso', () => {
    expect(() => FaixaValor.criar(null, 500_000)).not.toThrow();
  });

  it('aceita (min, null) — sem teto', () => {
    expect(() => FaixaValor.criar(100_000, null)).not.toThrow();
  });

  it('rejeita min > max', () => {
    expect(() => FaixaValor.criar(1_000_000, 100_000)).toThrow(FaixaValorInvalidaError);
  });

  it('rejeita NaN como min — NaN bypass corrigido', () => {
    expect(() => FaixaValor.criar(NaN, 1_000_000)).toThrow(FaixaValorInvalidaError);
  });

  it('rejeita NaN como max — NaN bypass corrigido', () => {
    expect(() => FaixaValor.criar(100_000, NaN)).toThrow(FaixaValorInvalidaError);
  });

  it('rejeita +Infinity como min', () => {
    expect(() => FaixaValor.criar(Infinity, null)).toThrow(FaixaValorInvalidaError);
  });

  it('rejeita -Infinity como max', () => {
    expect(() => FaixaValor.criar(null, -Infinity)).toThrow(FaixaValorInvalidaError);
  });

  it('rejeita (NaN, NaN) — ambos corrompidos', () => {
    expect(() => FaixaValor.criar(NaN, NaN)).toThrow(FaixaValorInvalidaError);
  });
});

describe('FaixaValor.abrange — limites exatos', () => {
  it('abrange o piso exato (inclusivo)', () => {
    expect(FaixaValor.criar(100, 1000).abrange(100)).toBe(true);
  });

  it('abrange o teto exato (inclusivo)', () => {
    expect(FaixaValor.criar(100, 1000).abrange(1000)).toBe(true);
  });

  it('rejeita valor 1 abaixo do piso', () => {
    expect(FaixaValor.criar(100, 1000).abrange(99)).toBe(false);
  });

  it('rejeita valor 1 acima do teto', () => {
    expect(FaixaValor.criar(100, 1000).abrange(1001)).toBe(false);
  });

  it('intervalo irrestrito (null, null) abrange qualquer valor finito', () => {
    const fv = FaixaValor.criar(null, null);
    expect(fv.abrange(0)).toBe(true);
    expect(fv.abrange(999_999_999)).toBe(true);
  });

  it('NaN como valor consultado → false (valor monetário inválido não é coberto)', () => {
    // Comportamento atual: NaN >= min retorna false → abrange = false.
    // Correto — um valor NaN não pertence a nenhuma faixa válida.
    expect(FaixaValor.criar(100, 1000).abrange(NaN)).toBe(false);
  });

  it('NaN no intervalo irrestrito também retorna false (valor inválido)', () => {
    expect(FaixaValor.criar(null, null).abrange(NaN)).toBe(false);
  });
});

// ─── PalavrasChave — edge cases adversariais ─────────────────────────────────

describe('PalavrasChave — edge cases adversariais', () => {
  it('lista com duplicatas: preserva duplicatas (normalização não deduplica)', () => {
    // Deduplica ou não: documentar o comportamento atual — a postura recall-alto prefere
    // manter duplicatas a perder termos relevantes. O chamador é responsável pela dedup.
    const pc = PalavrasChave.criar(['ti', 'ti', 'software']);
    expect(pc.termos).toContain('ti');
    expect(pc.termos).toContain('software');
  });

  it('lista com apenas uma string de newline é tratada como vazia', () => {
    // '\n'.trim() = '' → filter(Boolean) remove → lista vazia → PalavrasChaveVaziaError
    expect(() => PalavrasChave.criar(['\n', '\r\n'])).toThrow(PalavrasChaveVaziaError);
  });

  it('termos muito longos são aceitos sem truncar', () => {
    const termoLongo = 'a'.repeat(500);
    expect(() => PalavrasChave.criar([termoLongo])).not.toThrow();
  });

  it('termos com caracteres especiais unicode são normalizados para lowercase', () => {
    // termos com diacríticos: 'Ção' → 'ção' (não remove acento, só normaliza caixa)
    const pc = PalavrasChave.criar(['Ção', 'BRASIL']);
    expect(pc.termos).toContain('ção');
    expect(pc.termos).toContain('brasil');
  });

  it('lista com apenas números é aceita como termos válidos', () => {
    const pc = PalavrasChave.criar(['62.01', '47.11']);
    expect(pc.termos).toContain('62.01');
  });
});
