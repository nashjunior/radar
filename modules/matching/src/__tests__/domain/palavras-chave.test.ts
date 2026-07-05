import { describe, expect, it } from 'vitest';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { PalavrasChaveVaziaError } from '../../domain/errors/index.js';

describe('PalavrasChave', () => {
  describe('criar', () => {
    it('normaliza termos para lower-case e trim', () => {
      const pc = PalavrasChave.criar(['  TI  ', 'Software']);
      expect(pc.termos).toEqual(['ti', 'software']);
    });

    it('filtra strings em branco', () => {
      const pc = PalavrasChave.criar(['ti', '   ', 'saude']);
      expect(pc.termos).toEqual(['ti', 'saude']);
    });

    it('aceita lista com um único termo válido', () => {
      const pc = PalavrasChave.criar(['consultoria']);
      expect(pc.termos).toHaveLength(1);
    });

    it('lança PalavrasChaveVaziaError para lista vazia', () => {
      expect(() => PalavrasChave.criar([])).toThrow(PalavrasChaveVaziaError);
    });

    it('lança PalavrasChaveVaziaError quando todos os termos são em branco', () => {
      expect(() => PalavrasChave.criar(['   ', '\t', ''])).toThrow(PalavrasChaveVaziaError);
    });

    it('o erro tem code PALAVRAS_CHAVE_VAZIAS', () => {
      try {
        PalavrasChave.criar([]);
      } catch (e) {
        expect((e as PalavrasChaveVaziaError).code).toBe('PALAVRAS_CHAVE_VAZIAS');
      }
    });

    it('termos resultantes são preservados em ordem normalizada', () => {
      const pc = PalavrasChave.criar(['Obras', 'CONSTRUÇÃO', 'ti']);
      expect(pc.termos).toEqual(['obras', 'construção', 'ti']);
    });
  });
});
