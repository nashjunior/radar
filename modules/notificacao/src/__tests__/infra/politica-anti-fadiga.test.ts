import { describe, expect, it } from 'vitest';
import { politicaAntiFadigaDoAmbiente } from '../../infra/config/politica-anti-fadiga.js';

describe('politicaAntiFadigaDoAmbiente', () => {
  it('usa os defaults de P-81 quando nenhuma variável está presente', () => {
    const politica = politicaAntiFadigaDoAmbiente({});

    expect(politica).toEqual({
      caps: { DIARIA: 10, SEMANAL: 25 },
    });
  });

  it('lê os dois caps do ambiente quando presentes', () => {
    const politica = politicaAntiFadigaDoAmbiente({
      RADAR_NOTIF_CAP_DIARIO: '15',
      RADAR_NOTIF_CAP_SEMANAL: '40',
    });

    expect(politica).toEqual({
      caps: { DIARIA: 15, SEMANAL: 40 },
    });
  });

  it('cai no default quando a variável está presente mas não é um número', () => {
    const politica = politicaAntiFadigaDoAmbiente({ RADAR_NOTIF_CAP_DIARIO: 'abc' });

    expect(politica.caps.DIARIA).toBe(10);
  });

  it('cai no default quando a variável está vazia', () => {
    const politica = politicaAntiFadigaDoAmbiente({ RADAR_NOTIF_CAP_DIARIO: '' });

    expect(politica.caps.DIARIA).toBe(10);
  });
});
