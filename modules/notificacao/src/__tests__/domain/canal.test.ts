import { describe, expect, it } from 'vitest';
import { Canal } from '../../domain/value-objects/canal.js';
import { CanalInvalidoError } from '../../domain/errors/index.js';

describe('Canal', () => {
  describe('criar', () => {
    it('aceita EMAIL', () => {
      const c = Canal.criar('EMAIL');
      expect(c.tipo).toBe('EMAIL');
    });

    it('aceita WEBHOOK', () => {
      expect(Canal.criar('WEBHOOK').tipo).toBe('WEBHOOK');
    });

    it('aceita IN_APP', () => {
      expect(Canal.criar('IN_APP').tipo).toBe('IN_APP');
    });

    it('lança CanalInvalidoError para tipo desconhecido', () => {
      expect(() => Canal.criar('SMS')).toThrow(CanalInvalidoError);
    });

    it('o erro tem code CANAL_INVALIDO', () => {
      try {
        Canal.criar('PIGEON');
      } catch (e) {
        expect((e as CanalInvalidoError).code).toBe('CANAL_INVALIDO');
      }
    });
  });

  describe('ehEmail', () => {
    it('retorna true para EMAIL', () => {
      expect(Canal.criar('EMAIL').ehEmail).toBe(true);
    });

    it('retorna false para WEBHOOK', () => {
      expect(Canal.criar('WEBHOOK').ehEmail).toBe(false);
    });
  });
});
