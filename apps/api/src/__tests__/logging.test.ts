import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { criarLoggerHttpSeguro, redigirParaLog, redigirUrlParaLog } from '../logging.js';

describe('logging seguro da API', () => {
  it('redige query string antes de logar requisições HTTP', async () => {
    const linhas: string[] = [];
    const app = new Hono();
    app.use('*', criarLoggerHttpSeguro((mensagem) => linhas.push(mensagem)));
    app.get('/health', (c) => c.json({ ok: true }));

    await app.request('http://localhost/health?cpf=123.456.789-00&token=abc123&busca=email%40teste.com');

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('/health?cpf=[REDACTED]&token=[REDACTED]&busca=[REDACTED]');
    expect(linhas[0]).not.toContain('123.456.789-00');
    expect(linhas[0]).not.toContain('abc123');
    expect(linhas[0]).not.toContain('email@teste.com');
  });

  it('redige URL mesmo quando o handler lança erro', async () => {
    const linhas: string[] = [];
    const app = new Hono();
    app.use('*', criarLoggerHttpSeguro((mensagem) => linhas.push(mensagem)));
    app.get('/erro', () => {
      throw new Error('senha=segredo');
    });
    app.onError(() => new Response('erro', { status: 500 }));

    const res = await app.request('http://localhost/erro?senha=segredo');

    expect(res.status).toBe(500);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('/erro?senha=[REDACTED] 500');
    expect(linhas[0]).not.toContain('segredo');
  });

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
});
