import { describe, expect, it } from 'vitest';
import { redigirParaLog, redigirUrlParaLog } from '../redacao.js';

describe('redação de dado sensível (A18 §4 — invariante não-negociável)', () => {
  it('resume Error sem message nem stack', () => {
    const err = new Error('cpf=123.456.789-00 senha=segredo');
    err.stack = 'stack com token=abc123';

    const seguro = redigirParaLog(err);

    expect(seguro).toEqual({ tipo: 'Error' });
    expect(JSON.stringify(seguro)).not.toContain('123.456.789-00');
    expect(JSON.stringify(seguro)).not.toContain('segredo');
    expect(JSON.stringify(seguro)).not.toContain('abc123');
  });

  it('redige chaves e padrões sensíveis em objetos estruturados', () => {
    const seguro = redigirParaLog({
      usuario: 'pessoa@example.com',
      authorization: 'Bearer token-real',
      nested: { observacao: 'cpf 12345678900' },
    });

    expect(seguro).toEqual({
      usuario: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { observacao: 'cpf [REDACTED]' },
    });
  });

  it('redige padrões sensíveis em path quando houver entrada inesperada', () => {
    expect(redigirUrlParaLog('http://localhost/api/pessoa/123.456.789-00')).toBe('/api/pessoa/[REDACTED]');
  });

  it('é idempotente — redigir um texto já redigido não corrompe o prefixo key= (logger aplica redigirUrlParaLog e depois redigirParaLog sobre o registro inteiro)', () => {
    const primeira = redigirUrlParaLog('http://localhost/health?token=abc123&senha=segredo');
    const segunda = redigirParaLog(primeira);

    expect(segunda).toBe(primeira);
    expect(segunda).toBe('/health?token=[REDACTED]&senha=[REDACTED]');
  });

  it('redige campo a campo em objetos aninhados adicionados pelo call site (não só a string montada)', () => {
    const seguro = redigirParaLog({
      evento: 'triagem.solicitada',
      contexto: { cpfSolicitante: '123.456.789-00', token: 'segredo-de-sessao' },
    });

    expect(JSON.stringify(seguro)).not.toContain('123.456.789-00');
    expect(JSON.stringify(seguro)).not.toContain('segredo-de-sessao');
  });
});
