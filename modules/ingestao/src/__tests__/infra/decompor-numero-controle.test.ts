import { describe, expect, it } from 'vitest';
import { decomporNumeroControle } from '../../infra/adapters/pncp-http-gateway.js';
import { SchemaDriftError } from '../../domain/errors/index.js';

describe('decomporNumeroControle', () => {
  it('extrai cnpj/ano/sequencial sem padding', () => {
    expect(decomporNumeroControle('88124961000159-1-000074/2026')).toEqual({
      cnpj: '88124961000159',
      sequencial: '74',
      ano: '2026',
    });
  });

  it('rejeita formato inválido', () => {
    expect(() => decomporNumeroControle('invalido')).toThrow(SchemaDriftError);
  });
});
