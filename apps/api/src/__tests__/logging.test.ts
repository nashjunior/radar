import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { criarLoggerHttpSeguro, redigirParaLog, redigirUrlParaLog } from '../logging.js';

describe('logging seguro da API', () => {
  it('redige query string antes de logar requisições HTTP (JSON Lines, A18 §4)', async () => {
    const linhas: string[] = [];
    const app = new Hono();
    app.use('*', criarLoggerHttpSeguro((mensagem) => linhas.push(mensagem)));
    app.get('/health', (c) => c.json({ ok: true }));

    await app.request('http://localhost/health?cpf=123.456.789-00&token=abc123&busca=email%40teste.com');

    expect(linhas).toHaveLength(1);
    const registro = JSON.parse(linhas[0]!);
    expect(registro).toMatchObject({ nivel: 'info', contexto: 'api', evento: 'http.request', status: 200 });
    expect(registro.url).toBe('/health?cpf=[REDACTED]&token=[REDACTED]&busca=[REDACTED]');
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
    const registro = JSON.parse(linhas[0]!);
    expect(registro).toMatchObject({ nivel: 'error', url: '/erro?senha=[REDACTED]', status: 500 });
    expect(linhas[0]).not.toContain('segredo');
  });

  it('correlaciona: mesmo correlationId no traceparent do cliente e no log da requisição', async () => {
    const linhas: string[] = [];
    const app = new Hono();
    app.use('*', criarLoggerHttpSeguro((mensagem) => linhas.push(mensagem)));
    app.get('/health', (c) => c.json({ ok: true }));

    await app.request('http://localhost/health', {
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    });

    const registro = JSON.parse(linhas[0]!);
    expect(registro.correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('traceparent malformado do cliente nunca aparece em log algum (log forging, A18 §3.1)', async () => {
    const linhas: string[] = [];
    const app = new Hono();
    app.use('*', criarLoggerHttpSeguro((mensagem) => linhas.push(mensagem)));
    app.get('/health', (c) => c.json({ ok: true }));

    const forjado = 'nao-e-um-traceparent-valido-[FORJADO]-controlado-pelo-cliente';
    await app.request('http://localhost/health', { headers: { traceparent: forjado } });

    expect(linhas[0]).not.toContain(forjado);
    expect(linhas[0]).not.toContain('FORJADO');
    const registro = JSON.parse(linhas[0]!);
    expect(registro.correlationId).toMatch(/^[0-9a-f]{32}$/);
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
