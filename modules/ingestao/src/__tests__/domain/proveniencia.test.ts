import { describe, expect, it } from 'vitest';
import { Proveniencia } from '../../domain/value-objects/proveniencia.js';

describe('Proveniencia', () => {
  describe('criar', () => {
    it('preserva fonte, baseLegal e coletadoEm', () => {
      const data = new Date('2024-01-01T00:00:00Z');
      const p = Proveniencia.criar({
        fonte: 'PNCP',
        baseLegal: 'Lei 14.133/2021, art. 174',
        coletadoEm: data,
      });

      expect(p.fonte).toBe('PNCP');
      expect(p.baseLegal).toBe('Lei 14.133/2021, art. 174');
      expect(p.coletadoEm).toBe(data);
    });

    it('aceita qualquer string como fonte', () => {
      expect(() =>
        Proveniencia.criar({ fonte: 'OUTRA_FONTE', baseLegal: 'Art. 1', coletadoEm: new Date() }),
      ).not.toThrow();
    });
  });
});
