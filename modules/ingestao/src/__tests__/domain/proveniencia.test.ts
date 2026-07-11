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

  describe('equals (convenção VO CLAUDE.md)', () => {
    it('retorna true para instâncias com mesmos valores', () => {
      const dt = new Date('2024-01-01T00:00:00Z');
      const a = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      const b = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      expect(a.equals(b)).toBe(true);
    });

    it('retorna false quando fonte difere', () => {
      const dt = new Date('2024-01-01T00:00:00Z');
      const a = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      const b = Proveniencia.criar({ fonte: 'BEC-SP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      expect(a.equals(b)).toBe(false);
    });

    it('retorna false quando baseLegal difere', () => {
      const dt = new Date('2024-01-01T00:00:00Z');
      const a = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      const b = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Decreto 10.024/2019', coletadoEm: dt });
      expect(a.equals(b)).toBe(false);
    });

    it('retorna false quando coletadoEm difere', () => {
      const a = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date('2024-01-01T00:00:00Z') });
      const b = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date('2024-02-01T00:00:00Z') });
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString (convenção VO CLAUDE.md)', () => {
    it('inclui fonte, baseLegal e coletadoEm em ISO 8601', () => {
      const dt = new Date('2024-06-15T12:00:00.000Z');
      const p = Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: dt });
      const str = p.toString();
      expect(str).toContain('PNCP');
      expect(str).toContain('Lei 14.133/2021');
      expect(str).toContain('2024-06-15T12:00:00.000Z');
    });
  });
});
