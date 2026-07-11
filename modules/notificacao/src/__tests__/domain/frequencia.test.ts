import { describe, expect, it } from 'vitest';
import { CAP_DIGEST, Frequencia } from '../../domain/value-objects/frequencia.js';
import { PreferenciaInvalidaError } from '../../domain/errors/index.js';

describe('Frequencia', () => {
  describe('criar', () => {
    it('aceita IMEDIATA', () => {
      expect(Frequencia.criar('IMEDIATA').tipo).toBe('IMEDIATA');
    });

    it('aceita DIARIA', () => {
      expect(Frequencia.criar('DIARIA').tipo).toBe('DIARIA');
    });

    it('aceita SEMANAL', () => {
      expect(Frequencia.criar('SEMANAL').tipo).toBe('SEMANAL');
    });

    it('lança PreferenciaInvalidaError para tipo desconhecido', () => {
      expect(() => Frequencia.criar('MENSAL')).toThrow(PreferenciaInvalidaError);
    });

    it('o erro tem code PREFERENCIA_INVALIDA', () => {
      try {
        Frequencia.criar('INVALIDO');
      } catch (e) {
        expect((e as PreferenciaInvalidaError).code).toBe('PREFERENCIA_INVALIDA');
      }
    });
  });

  describe('ehImediata', () => {
    it('retorna true para IMEDIATA', () => {
      expect(Frequencia.criar('IMEDIATA').ehImediata).toBe(true);
    });

    it('retorna false para DIARIA', () => {
      expect(Frequencia.criar('DIARIA').ehImediata).toBe(false);
    });

    it('retorna false para SEMANAL', () => {
      expect(Frequencia.criar('SEMANAL').ehImediata).toBe(false);
    });
  });

  describe('CAP_DIGEST (P-81)', () => {
    it('reflete o cap por frequência da decisão de Produto (10 diário / 25 semanal)', () => {
      expect(CAP_DIGEST).toEqual({ DIARIA: 10, SEMANAL: 25 });
    });
  });
});
