import { describe, expect, it } from 'vitest';
import { Cnpj } from '../../domain/value-objects/cnpj.js';

// CNPJ válido da Receita Federal: 11.222.333/0001-81
const VALIDO = '11.222.333/0001-81';
const VALIDO_RAW = '11222333000181';

describe('Cnpj', () => {
  describe('criar — CNPJs válidos', () => {
    it('aceita CNPJ formatado com pontos, barra e hífen', () => {
      const c = Cnpj.criar(VALIDO);
      expect(c.valor).toBe(VALIDO_RAW);
    });

    it('aceita CNPJ como 14 dígitos sem formatação', () => {
      const c = Cnpj.criar(VALIDO_RAW);
      expect(c.valor).toBe(VALIDO_RAW);
    });

    it('armazena apenas os 14 dígitos (sem pontuação)', () => {
      expect(Cnpj.criar(VALIDO).valor).toMatch(/^\d{14}$/);
    });
  });

  describe('criar — CNPJs inválidos', () => {
    it('rejeita string vazia', () => {
      expect(() => Cnpj.criar('')).toThrow();
    });

    it('rejeita CNPJ com menos de 14 dígitos', () => {
      expect(() => Cnpj.criar('1234567890123')).toThrow();
    });

    it('rejeita CNPJ com todos dígitos iguais (00000000000000)', () => {
      expect(() => Cnpj.criar('00000000000000')).toThrow();
    });

    it('rejeita CNPJ com todos dígitos iguais (11111111111111)', () => {
      expect(() => Cnpj.criar('11111111111111')).toThrow();
    });

    it('rejeita CNPJ com dígito verificador errado', () => {
      // Altera o último dígito do CNPJ válido
      const invalido = VALIDO_RAW.slice(0, 13) + '0';
      expect(() => Cnpj.criar(invalido)).toThrow();
    });

    it('erro tem code CNPJ_INVALIDO', () => {
      try {
        Cnpj.criar('invalido');
      } catch (e: any) {
        expect(e.code).toBe('CNPJ_INVALIDO');
      }
    });
  });

  describe('formatado()', () => {
    it('retorna no formato XX.XXX.XXX/XXXX-XX', () => {
      expect(Cnpj.criar(VALIDO_RAW).formatado()).toBe(VALIDO);
    });
  });

  describe('equals()', () => {
    it('dois CNPJs iguais são iguais', () => {
      expect(Cnpj.criar(VALIDO).equals(Cnpj.criar(VALIDO_RAW))).toBe(true);
    });

    it('CNPJs diferentes não são iguais', () => {
      // Outro CNPJ válido: 45.997.418/0001-53
      expect(Cnpj.criar(VALIDO_RAW).equals(Cnpj.criar('45997418000153'))).toBe(false);
    });
  });
});
