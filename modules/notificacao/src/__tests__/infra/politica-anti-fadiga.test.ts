import { describe, expect, it } from 'vitest';
import { politicaAntiFadigaDoAmbiente } from '../../infra/config/politica-anti-fadiga.js';

describe('politicaAntiFadigaDoAmbiente', () => {
  it('usa os defaults de P-81 quando nenhuma variável está presente', () => {
    const politica = politicaAntiFadigaDoAmbiente({});

    expect(politica).toEqual({
      limiares: { diasAtePrazo: 3, aderencia: 0.8 },
      caps: { DIARIA: 10, SEMANAL: 25 },
    });
  });

  it('lê os quatro números do ambiente quando presentes', () => {
    const politica = politicaAntiFadigaDoAmbiente({
      RADAR_NOTIF_CRITICO_DIAS: '5',
      RADAR_NOTIF_CRITICO_ADERENCIA: '0.9',
      RADAR_NOTIF_CAP_DIARIO: '15',
      RADAR_NOTIF_CAP_SEMANAL: '40',
    });

    expect(politica).toEqual({
      limiares: { diasAtePrazo: 5, aderencia: 0.9 },
      caps: { DIARIA: 15, SEMANAL: 40 },
    });
  });

  it('cai no default quando a variável está presente mas não é um número', () => {
    const politica = politicaAntiFadigaDoAmbiente({ RADAR_NOTIF_CRITICO_DIAS: 'abc' });

    expect(politica.limiares.diasAtePrazo).toBe(3);
  });

  it('cai no default quando a variável está vazia', () => {
    const politica = politicaAntiFadigaDoAmbiente({ RADAR_NOTIF_CAP_DIARIO: '' });

    expect(politica.caps.DIARIA).toBe(10);
  });
});
