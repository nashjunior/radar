import { describe, expect, it } from 'vitest';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { FaixaValorInvalidaError } from '../../domain/errors/index.js';

describe('FaixaValor', () => {
  describe('criar', () => {
    it('aceita min e max válidos', () => {
      const fv = FaixaValor.criar(100_000, 1_000_000);
      expect(fv.min).toBe(100_000);
      expect(fv.max).toBe(1_000_000);
    });

    it('aceita sem piso (min = null)', () => {
      const fv = FaixaValor.criar(null, 500_000);
      expect(fv.min).toBeNull();
    });

    it('aceita sem teto (max = null)', () => {
      const fv = FaixaValor.criar(100_000, null);
      expect(fv.max).toBeNull();
    });

    it('aceita min = max', () => {
      expect(() => FaixaValor.criar(100, 100)).not.toThrow();
    });

    it('lança FaixaValorInvalidaError quando min > max', () => {
      expect(() => FaixaValor.criar(1_000_000, 100_000)).toThrow(FaixaValorInvalidaError);
    });

    it('o erro tem code FAIXA_VALOR_INVALIDA', () => {
      try {
        FaixaValor.criar(10, 5);
      } catch (e) {
        expect((e as FaixaValorInvalidaError).code).toBe('FAIXA_VALOR_INVALIDA');
      }
    });
  });

  describe('abrange', () => {
    it('cobre valor dentro do intervalo fechado', () => {
      const fv = FaixaValor.criar(100, 1000);
      expect(fv.abrange(500)).toBe(true);
    });

    it('cobre o piso exato', () => {
      expect(FaixaValor.criar(100, 1000).abrange(100)).toBe(true);
    });

    it('cobre o teto exato', () => {
      expect(FaixaValor.criar(100, 1000).abrange(1000)).toBe(true);
    });

    it('rejeita valor abaixo do piso', () => {
      expect(FaixaValor.criar(100, 1000).abrange(50)).toBe(false);
    });

    it('rejeita valor acima do teto', () => {
      expect(FaixaValor.criar(100, 1000).abrange(1001)).toBe(false);
    });

    it('sem piso: aceita qualquer valor abaixo do teto', () => {
      expect(FaixaValor.criar(null, 1000).abrange(1)).toBe(true);
    });

    it('sem teto: aceita qualquer valor acima do piso', () => {
      expect(FaixaValor.criar(100, null).abrange(999_999)).toBe(true);
    });
  });
});
