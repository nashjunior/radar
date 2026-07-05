import { describe, expect, it } from 'vitest';
import { Criticidade } from '../../domain/value-objects/criticidade.js';

describe('Criticidade', () => {
  describe('criar — limiar P-81 = 3 dias', () => {
    it('urgente quando diasAtePrazo = 0', () => {
      expect(Criticidade.criar(0).exigeImediato).toBe(true);
    });

    it('urgente quando diasAtePrazo = 3 (inclusive)', () => {
      expect(Criticidade.criar(3).exigeImediato).toBe(true);
    });

    it('não urgente quando diasAtePrazo = 4', () => {
      expect(Criticidade.criar(4).exigeImediato).toBe(false);
    });

    it('não urgente quando diasAtePrazo = 30', () => {
      expect(Criticidade.criar(30).exigeImediato).toBe(false);
    });
  });

  describe('canalForcado', () => {
    it('é EMAIL independente da urgência', () => {
      expect(Criticidade.criar(0).canalForcado).toBe('EMAIL');
      expect(Criticidade.criar(30).canalForcado).toBe('EMAIL');
    });
  });
});
