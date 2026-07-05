import { describe, expect, it } from 'vitest';
import { NumeroControlePncp } from '../../domain/value-objects/numero-controle-pncp.js';

const NUMERO_VALIDO = '00394502000167-1-000001/2024';

describe('NumeroControlePncp', () => {
  describe('criar — valores válidos', () => {
    it('aceita string não-vazia', () => {
      const n = NumeroControlePncp.criar(NUMERO_VALIDO);
      expect(n.valor).toBe(NUMERO_VALIDO);
    });

    it('aplica trim no valor', () => {
      const n = NumeroControlePncp.criar('  ' + NUMERO_VALIDO + '  ');
      expect(n.valor).toBe(NUMERO_VALIDO);
    });

    it('preserva hífens e barras do formato PNCP', () => {
      expect(NumeroControlePncp.criar(NUMERO_VALIDO).valor).toBe(NUMERO_VALIDO);
    });
  });

  describe('criar — valores inválidos', () => {
    it('rejeita string vazia', () => {
      expect(() => NumeroControlePncp.criar('')).toThrow();
    });

    it('rejeita string só de espaços', () => {
      expect(() => NumeroControlePncp.criar('   ')).toThrow();
    });

    it('erro tem code NUMERO_CONTROLE_PNCP_INVALIDO', () => {
      try {
        NumeroControlePncp.criar('');
      } catch (e: any) {
        expect(e.code).toBe('NUMERO_CONTROLE_PNCP_INVALIDO');
      }
    });
  });

  describe('equals()', () => {
    it('dois números iguais são iguais', () => {
      expect(
        NumeroControlePncp.criar(NUMERO_VALIDO).equals(NumeroControlePncp.criar(NUMERO_VALIDO)),
      ).toBe(true);
    });

    it('números diferentes não são iguais', () => {
      expect(
        NumeroControlePncp.criar(NUMERO_VALIDO).equals(
          NumeroControlePncp.criar('00394502000167-1-000002/2024'),
        ),
      ).toBe(false);
    });
  });
});
