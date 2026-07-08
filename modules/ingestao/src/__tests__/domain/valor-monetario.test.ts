import { describe, expect, it } from 'vitest';
import { ValorMonetario } from '../../domain/value-objects/valor-monetario.js';

describe('ValorMonetario', () => {
  describe('criar — entradas válidas', () => {
    it('aceita zero como number', () => {
      expect(ValorMonetario.criar(0).valor).toBe(0);
    });

    it('aceita valor inteiro positivo como number', () => {
      expect(ValorMonetario.criar(1000).valor).toBe(1000);
    });

    it('aceita decimal positivo como number', () => {
      expect(ValorMonetario.criar(1234.56).representacaoDecimal).toBe('1234.56');
    });

    it('aceita string decimal exata do PostgreSQL', () => {
      const vm = ValorMonetario.criar('1234567.8900');
      expect(vm.representacaoDecimal).toBe('1234567.8900');
      expect(vm.valor).toBeCloseTo(1234567.89);
    });

    it('aceita string inteira', () => {
      expect(ValorMonetario.criar('500').valor).toBe(500);
    });

    it('aceita string com ponto decimal "0.0015"', () => {
      expect(ValorMonetario.criar('0.0015').representacaoDecimal).toBe('0.0015');
    });

    it('aceita string com espaços ao redor', () => {
      expect(ValorMonetario.criar('  500  ').valor).toBe(500);
    });
  });

  describe('criar — entradas inválidas', () => {
    it('rejeita número negativo', () => {
      expect(() => ValorMonetario.criar(-1)).toThrow();
    });

    it('rejeita Infinity', () => {
      expect(() => ValorMonetario.criar(Infinity)).toThrow();
    });

    it('rejeita NaN', () => {
      expect(() => ValorMonetario.criar(NaN)).toThrow();
    });

    it('rejeita string vazia', () => {
      expect(() => ValorMonetario.criar('')).toThrow();
    });

    it('rejeita string com letras', () => {
      expect(() => ValorMonetario.criar('R$ 500')).toThrow();
    });

    it('rejeita string com vírgula (formato br)', () => {
      expect(() => ValorMonetario.criar('1.234,56')).toThrow();
    });

    it('rejeita negativo em string', () => {
      expect(() => ValorMonetario.criar('-5')).toThrow();
    });

    it('erro tem code VALOR_MONETARIO_INVALIDO', () => {
      try {
        ValorMonetario.criar(-1);
      } catch (e: any) {
        expect(e.code).toBe('VALOR_MONETARIO_INVALIDO');
      }
    });
  });

  describe('toString()', () => {
    it('retorna representação decimal exata', () => {
      expect(ValorMonetario.criar('1234.56').toString()).toBe('1234.56');
    });
  });

  describe('equals()', () => {
    it('"1.00" é igual a "1.0" (mesmo valor numérico)', () => {
      expect(ValorMonetario.criar('1.00').equals(ValorMonetario.criar('1.0'))).toBe(true);
    });

    it('valores diferentes não são iguais', () => {
      expect(ValorMonetario.criar(100).equals(ValorMonetario.criar(200))).toBe(false);
    });
  });
});
