import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { criarApp } from '../server.js';
import { responderErro } from '../errors.js';
import { Hono } from 'hono';

describe('segurança da borda HTTP', () => {
  it('aplica headers defensivos também em rota pública', async () => {
    const app = criarApp();
    const res = await app.request('http://localhost/health');

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('responde preflight CORS apenas para origem permitida em dev', async () => {
    const app = criarApp();
    const res = await app.request('http://localhost/api/matching/criterios', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Authorization, Content-Type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('não emite allow-origin para origem fora da allowlist', async () => {
    const app = criarApp();
    const res = await app.request('http://localhost/api/matching/criterios', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('bloqueia CSRF cross-site em content-types de formulário antes da rota', async () => {
    const app = criarApp();
    const res = await app.request('http://localhost/api/matching/criterios', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'text/plain',
      },
      body: 'regiaoUf=SP',
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { code: string; mensagem: string };
    expect(body).toEqual({ code: 'ACESSO_NEGADO', mensagem: 'Acesso negado.' });
  });

  it('mapeia HTTPException sem vazar corpo interno', async () => {
    const app = new Hono();
    app.get('/erro', (c) => responderErro(c, new HTTPException(403, {
      message: 'origem https://evil.example bloqueada',
    })));

    const res = await app.request('http://localhost/erro');
    const body = await res.json() as { code: string; mensagem: string };

    expect(res.status).toBe(403);
    expect(body).toEqual({ code: 'ACESSO_NEGADO', mensagem: 'Acesso negado.' });
    expect(JSON.stringify(body)).not.toContain('evil.example');
  });
});
