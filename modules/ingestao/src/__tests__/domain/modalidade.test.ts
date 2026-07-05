import { describe, expect, it } from 'vitest';
import { Modalidade } from '../../domain/value-objects/modalidade.js';

describe('Modalidade', () => {
  describe('criar — valores válidos', () => {
    it('cria modalidade com código inteiro positivo', () => {
      const m = Modalidade.criar(1, 'Pregão Eletrônico');
      expect(m.codigo).toBe(1);
      expect(m.nome).toBe('Pregão Eletrônico');
    });

    it('aplica trim no nome', () => {
      const m = Modalidade.criar(6, '  Concorrência  ');
      expect(m.nome).toBe('Concorrência');
    });

    it('aceita qualquer inteiro positivo como código', () => {
      expect(() => Modalidade.criar(99, 'Teste')).not.toThrow();
    });
  });

  describe('criar — valores inválidos', () => {
    it('rejeita código zero', () => {
      expect(() => Modalidade.criar(0, 'Pregão')).toThrow();
    });

    it('rejeita código negativo', () => {
      expect(() => Modalidade.criar(-1, 'Pregão')).toThrow();
    });

    it('rejeita código decimal (não inteiro)', () => {
      expect(() => Modalidade.criar(1.5, 'Pregão')).toThrow();
    });

    it('erro tem code MODALIDADE_INVALIDA', () => {
      try {
        Modalidade.criar(0, 'Pregão');
      } catch (e: any) {
        expect(e.code).toBe('MODALIDADE_INVALIDA');
      }
    });
  });

  describe('equals()', () => {
    it('duas modalidades com o mesmo código são iguais', () => {
      expect(Modalidade.criar(1, 'Pregão').equals(Modalidade.criar(1, 'Outro Nome'))).toBe(true);
    });

    it('modalidades com códigos diferentes não são iguais', () => {
      expect(Modalidade.criar(1, 'Pregão').equals(Modalidade.criar(2, 'Pregão'))).toBe(false);
    });
  });

  describe('toString()', () => {
    it('retorna código — nome', () => {
      expect(Modalidade.criar(1, 'Pregão Eletrônico').toString()).toBe('1 — Pregão Eletrônico');
    });
  });
});
