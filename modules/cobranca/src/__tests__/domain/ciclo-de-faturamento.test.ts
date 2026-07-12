import { describe, expect, it } from 'vitest';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';

describe('CicloDeFaturamento', () => {
  it('cria ciclo válido', () => {
    const c = CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    expect(c.contem(new Date('2026-07-15T00:00:00Z'))).toBe(true);
    expect(c.contem(new Date('2026-08-01T00:00:00Z'))).toBe(false);
  });

  it('rejeita fim anterior ou igual a inicio', () => {
    expect(() =>
      CicloDeFaturamento.criar(new Date('2026-08-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z')),
    ).toThrow();
    expect(() =>
      CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z')),
    ).toThrow();
  });

  it('rejeita datas inválidas', () => {
    expect(() => CicloDeFaturamento.criar(new Date('invalid'), new Date('2026-08-01T00:00:00Z'))).toThrow();
  });
});
