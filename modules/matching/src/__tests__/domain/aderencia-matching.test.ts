import { describe, expect, it } from 'vitest';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { AderenciaMatchingInvalidaError } from '../../domain/errors/index.js';

describe('AderenciaMatching', () => {
  describe('criar', () => {
    it('aceita valor 0', () => {
      const a = AderenciaMatching.criar(0);
      expect(a.valor).toBe(0);
    });

    it('aceita valor 1', () => {
      const a = AderenciaMatching.criar(1);
      expect(a.valor).toBe(1);
    });

    it('aceita valor intermediário', () => {
      const a = AderenciaMatching.criar(0.5);
      expect(a.valor).toBe(0.5);
    });

    it('lança AderenciaMatchingInvalidaError para valor negativo', () => {
      expect(() => AderenciaMatching.criar(-0.1)).toThrow(AderenciaMatchingInvalidaError);
    });

    it('lança AderenciaMatchingInvalidaError para valor acima de 1', () => {
      expect(() => AderenciaMatching.criar(1.01)).toThrow(AderenciaMatchingInvalidaError);
    });

    it('o erro tem code ADERENCIA_MATCHING_INVALIDA', () => {
      try {
        AderenciaMatching.criar(-1);
      } catch (e) {
        expect((e as AderenciaMatchingInvalidaError).code).toBe('ADERENCIA_MATCHING_INVALIDA');
      }
    });
  });

  describe('superaLimiar', () => {
    it('retorna false abaixo do limiar (0.29)', () => {
      expect(AderenciaMatching.criar(0.29).superaLimiar).toBe(false);
    });

    it('retorna true exatamente no limiar (0.3)', () => {
      expect(AderenciaMatching.criar(0.3).superaLimiar).toBe(true);
    });

    it('retorna true acima do limiar', () => {
      expect(AderenciaMatching.criar(0.8).superaLimiar).toBe(true);
    });
  });

  describe('ehAlta', () => {
    it('retorna false abaixo de 0.7', () => {
      expect(AderenciaMatching.criar(0.69).ehAlta).toBe(false);
    });

    it('retorna true em 0.7', () => {
      expect(AderenciaMatching.criar(0.7).ehAlta).toBe(true);
    });
  });
});
