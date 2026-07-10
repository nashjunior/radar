/**
 * Testes de domínio — TitularRef VO (P-105/docs/05 §9/RAD-152).
 *
 * Invariante: CPF bruto e e-mail não hasheado são rejeitados com TitularRefPiiError.
 * Referências opacas (hashes, IDs externos) passam sem restrição.
 */
import { describe, expect, it } from 'vitest';
import { TitularRef, TitularRefPiiError } from '../../domain/value-objects/titular-ref.js';

describe('TitularRef — rejeita CPF bruto', () => {
  it.each([
    '123.456.789-09',
    '123456789-09',
    '123.456.78909',
    '12345678909',
    '000.000.000-00',
  ])('rejeita "%s" como CPF bruto', (cpf) => {
    expect(() => TitularRef.criar(cpf)).toThrow(TitularRefPiiError);
  });

  it('TitularRefPiiError.code = TITULAR_REF_PII_DETECTADO', () => {
    try {
      TitularRef.criar('123.456.789-09');
    } catch (e) {
      expect((e as TitularRefPiiError).code).toBe('TITULAR_REF_PII_DETECTADO');
    }
  });
});

describe('TitularRef — rejeita e-mail bruto', () => {
  it.each([
    'usuario@empresa.com',
    'titular@dominio.org',
    'nome.sobrenome@mail.com.br',
    'test+alias@example.io',
  ])('rejeita "%s" como e-mail bruto', (email) => {
    expect(() => TitularRef.criar(email)).toThrow(TitularRefPiiError);
  });
});

describe('TitularRef — aceita referências/hashes opacos', () => {
  it.each([
    'titular-hash-xyz',
    'hash-1',
    'sha256-a3f1b2c4d5e6',
    'ref:opaca:123',
    'uuid-de-titular-4f5e6d',
    'hash',
    'IDEXTERNOabc123',
    'a'.repeat(64),
  ])('aceita "%s" como referência válida', (ref) => {
    expect(() => TitularRef.criar(ref)).not.toThrow();
    expect(TitularRef.criar(ref).value).toBe(ref);
  });
});

describe('TitularRef — comportamento do VO', () => {
  it('toString() retorna o valor da referência', () => {
    const ref = TitularRef.criar('minha-referencia-opaca');
    expect(ref.toString()).toBe('minha-referencia-opaca');
  });

  it('value expõe o valor da referência', () => {
    const ref = TitularRef.criar('hash-abc');
    expect(ref.value).toBe('hash-abc');
  });

  it('dois TitularRef com mesmo valor têm value igual', () => {
    const a = TitularRef.criar('ref-123');
    const b = TitularRef.criar('ref-123');
    expect(a.value).toBe(b.value);
  });
});
