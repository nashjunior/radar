import { describe, expect, it } from 'vitest';
import { DIAS_ATE_PRAZO_CRITICO_PADRAO, PrazoCritico } from '../../domain/value-objects/prazo-critico.js';

const AGORA = new Date('2026-07-12T00:00:00.000Z');

describe('PrazoCritico', () => {
  it('não é crítico quando o edital não informa prazoProposta', () => {
    expect(PrazoCritico.calcular(null, AGORA).critico).toBe(false);
  });

  it('é crítico quando o prazo cai dentro do limiar de dias corridos (P-81)', () => {
    const prazoEm2Dias = new Date('2026-07-14T00:00:00.000Z');
    expect(PrazoCritico.calcular(prazoEm2Dias, AGORA).critico).toBe(true);
  });

  it('é crítico no limite exato do limiar (3 dias)', () => {
    const prazoEm3Dias = new Date('2026-07-15T00:00:00.000Z');
    expect(PrazoCritico.calcular(prazoEm3Dias, AGORA).critico).toBe(true);
  });

  it('não é crítico quando o prazo está além do limiar', () => {
    const prazoEm4Dias = new Date('2026-07-16T00:00:00.000Z');
    expect(PrazoCritico.calcular(prazoEm4Dias, AGORA).critico).toBe(false);
  });

  it('não é crítico quando o prazo já passou', () => {
    const prazoOntem = new Date('2026-07-11T00:00:00.000Z');
    expect(PrazoCritico.calcular(prazoOntem, AGORA).critico).toBe(false);
  });

  it('respeita um limiar customizado', () => {
    const prazoEm5Dias = new Date('2026-07-17T00:00:00.000Z');
    expect(PrazoCritico.calcular(prazoEm5Dias, AGORA, 7).critico).toBe(true);
  });

  it('usa 3 dias como default (P-81, docs/08 §4.1)', () => {
    expect(DIAS_ATE_PRAZO_CRITICO_PADRAO).toBe(3);
  });

  describe('reconstituir', () => {
    it('reconstrói o booleano persistido sem recalcular', () => {
      expect(PrazoCritico.reconstituir(true).critico).toBe(true);
      expect(PrazoCritico.reconstituir(false).critico).toBe(false);
    });
  });

  describe('equals', () => {
    it('compara pelo valor de critico', () => {
      const a = PrazoCritico.calcular(null, AGORA);
      const b = PrazoCritico.reconstituir(false);
      expect(a.equals(b)).toBe(true);
    });
  });
});
