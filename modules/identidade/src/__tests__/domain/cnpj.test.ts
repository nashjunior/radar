import { describe, expect, it } from 'vitest';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { CnpjInvalidoError } from '../../domain/errors.js';

describe('Cnpj', () => {
  it('aceita um CNPJ válido com máscara e normaliza', () => {
    const cnpj = Cnpj.criar('11.222.333/0001-81');
    expect(cnpj.valor).toBe('11222333000181');
    expect(cnpj.toString()).toBe('11222333000181');
  });

  it('aceita o mesmo CNPJ sem máscara', () => {
    const cnpj = Cnpj.criar('11222333000181');
    expect(cnpj.valor).toBe('11222333000181');
  });

  it('rejeita comprimento diferente de 14 dígitos', () => {
    expect(() => Cnpj.criar('123')).toThrow(CnpjInvalidoError);
  });

  it('rejeita todos os dígitos iguais', () => {
    expect(() => Cnpj.criar('11111111111111')).toThrow(CnpjInvalidoError);
    expect(() => Cnpj.criar('00000000000000')).toThrow(CnpjInvalidoError);
  });

  it('rejeita primeiro dígito verificador inválido', () => {
    expect(() => Cnpj.criar('11222333000191')).toThrow(CnpjInvalidoError);
  });

  it('rejeita segundo dígito verificador inválido', () => {
    expect(() => Cnpj.criar('11222333000180')).toThrow(CnpjInvalidoError);
  });

  it('equals compara pelo valor normalizado', () => {
    const a = Cnpj.criar('11.222.333/0001-81');
    const b = Cnpj.criar('11222333000181');
    expect(a.equals(b)).toBe(true);
  });
});
