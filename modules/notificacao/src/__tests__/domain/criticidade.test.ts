import { describe, expect, it } from 'vitest';
import {
  Criticidade,
  LIMIARES_CRITICIDADE_PADRAO,
} from '../../domain/value-objects/criticidade.js';

describe('Criticidade', () => {
  describe('deAlerta — condição OU (P-81: prazo ≤ 3 dias OU aderência ≥ 0,80)', () => {
    it('crítico quando prazo longe mas aderência alta (10 dias, aderência 0,80)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 10, aderencia: 0.8 }).exigeImediato).toBe(true);
    });

    it('crítico quando prazo curto mas aderência baixa (3 dias, aderência 0,10)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 3, aderencia: 0.1 }).exigeImediato).toBe(true);
    });

    it('não crítico quando nem prazo nem aderência cruzam o limiar (10 dias, aderência 0,79)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 10, aderencia: 0.79 }).exigeImediato).toBe(false);
    });

    it('crítico quando ambas condições valem', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 1, aderencia: 0.95 }).exigeImediato).toBe(true);
    });
  });

  describe('borda de prazo — inclusiva (<= 3)', () => {
    it('crítico em diasAtePrazo = 0 (aderência irrelevante)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 0, aderencia: 0 }).exigeImediato).toBe(true);
    });

    it('crítico em diasAtePrazo = 3 (inclusive)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 3, aderencia: 0 }).exigeImediato).toBe(true);
    });

    it('não crítico em diasAtePrazo = 4 quando aderência não compensa', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 4, aderencia: 0 }).exigeImediato).toBe(false);
    });
  });

  describe('borda de aderência — inclusiva (>= 0.80)', () => {
    it('crítico em aderência = 0,80 (inclusive)', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 30, aderencia: 0.8 }).exigeImediato).toBe(true);
    });

    it('não crítico em aderência = 0,79 quando prazo não compensa', () => {
      expect(Criticidade.deAlerta({ diasAtePrazo: 30, aderencia: 0.79 }).exigeImediato).toBe(false);
    });
  });

  describe('limiares injetados (config — composition root)', () => {
    it('usa limiares customizados no lugar do padrão de P-81', () => {
      const limiaresCustom = { diasAtePrazo: 1, aderencia: 0.9 };
      expect(
        Criticidade.deAlerta({ diasAtePrazo: 2, aderencia: 0.85 }, limiaresCustom).exigeImediato,
      ).toBe(false);
      expect(
        Criticidade.deAlerta({ diasAtePrazo: 1, aderencia: 0.5 }, limiaresCustom).exigeImediato,
      ).toBe(true);
    });

    it('LIMIARES_CRITICIDADE_PADRAO reflete a decisão P-81 (3 dias / 0,80)', () => {
      expect(LIMIARES_CRITICIDADE_PADRAO).toEqual({ diasAtePrazo: 3, aderencia: 0.8 });
    });
  });
});
