import { describe, expect, it } from 'vitest';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import { CotaMensal } from '../../domain/value-objects/cota-mensal.js';

describe('PlanoComercial', () => {
  it('cria plano válido, com cota como VO', () => {
    const p = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 50, precoCentavos: 19900 });
    expect(p.codigo).toBe('starter');
    expect(p.cota.valor).toBe(50);
    expect(p.precoCentavos).toBe(19900);
  });

  it('rejeita codigo vazio', () => {
    expect(() => PlanoComercial.criar({ codigo: '  ', cotaTriagensMes: 10, precoCentavos: 100 })).toThrow();
  });

  it('rejeita precoCentavos negativo', () => {
    expect(() => PlanoComercial.criar({ codigo: 'x', cotaTriagensMes: 10, precoCentavos: -1 })).toThrow();
  });

  it('propaga a validação de CotaMensal (cota <= 0)', () => {
    expect(() => PlanoComercial.criar({ codigo: 'x', cotaTriagensMes: 0, precoCentavos: 100 })).toThrow();
  });
});

describe('CotaMensal', () => {
  it('rejeita valor não-inteiro', () => {
    expect(() => CotaMensal.criar(1.5)).toThrow();
  });

  it('equals compara por valor', () => {
    expect(CotaMensal.criar(10).equals(CotaMensal.criar(10))).toBe(true);
    expect(CotaMensal.criar(10).equals(CotaMensal.criar(11))).toBe(false);
  });
});
