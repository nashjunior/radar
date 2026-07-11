import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchApi } from './http-client';
import { SessaoExpiradaError, AcessoNegadoError } from '@/application/errors';

function makeFetch(status: number, body: unknown = null) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const TOKEN = 'tok-abc';
const withToken = () => Promise.resolve(TOKEN);
const noToken = () => Promise.resolve(null);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchApi — auth header', () => {
  it('adds Authorization when token present', async () => {
    const mockFetch = makeFetch(200, {});
    vi.stubGlobal('fetch', mockFetch);
    await fetchApi('/api/x', withToken);
    expect(mockFetch).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
    }));
  });

  it('omits Authorization when token is null', async () => {
    const mockFetch = makeFetch(200, {});
    vi.stubGlobal('fetch', mockFetch);
    await fetchApi('/api/x', noToken);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Authorization']).toBeUndefined();
  });
});

describe('fetchApi — Content-Type', () => {
  it('adds Content-Type when json: true', async () => {
    const mockFetch = makeFetch(200, {});
    vi.stubGlobal('fetch', mockFetch);
    await fetchApi('/api/x', noToken, { json: true });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('omits Content-Type by default', async () => {
    const mockFetch = makeFetch(200, {});
    vi.stubGlobal('fetch', mockFetch);
    await fetchApi('/api/x', noToken);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('fetchApi — status mapping', () => {
  it('401 → SessaoExpiradaError', async () => {
    vi.stubGlobal('fetch', makeFetch(401));
    await expect(fetchApi('/api/x', withToken)).rejects.toBeInstanceOf(SessaoExpiradaError);
  });

  it('403 → AcessoNegadoError by default', async () => {
    vi.stubGlobal('fetch', makeFetch(403));
    await expect(fetchApi('/api/x', withToken)).rejects.toBeInstanceOf(AcessoNegadoError);
  });

  it('403 → null when on403: null', async () => {
    vi.stubGlobal('fetch', makeFetch(403));
    const result = await fetchApi('/api/x', withToken, { on403: 'null' });
    expect(result).toBeNull();
  });

  it('404 → throws generic error by default', async () => {
    vi.stubGlobal('fetch', makeFetch(404));
    await expect(fetchApi('/api/x', withToken)).rejects.toThrow('HTTP 404');
  });

  it('404 → null when on404: null', async () => {
    vi.stubGlobal('fetch', makeFetch(404));
    const result = await fetchApi('/api/x', withToken, { on404: 'null' });
    expect(result).toBeNull();
  });

  it('500 → throws generic error', async () => {
    vi.stubGlobal('fetch', makeFetch(500));
    await expect(fetchApi('/api/x', withToken)).rejects.toThrow('HTTP 500');
  });

  it('200 → returns Response', async () => {
    vi.stubGlobal('fetch', makeFetch(200, { ok: true }));
    const res = await fetchApi('/api/x', withToken);
    expect(res).toBeInstanceOf(Response);
    expect((await res!.json())).toEqual({ ok: true });
  });
});

describe('fetchApi — passthrough options', () => {
  it('forwards method, body, signal', async () => {
    const mockFetch = makeFetch(201, {});
    vi.stubGlobal('fetch', mockFetch);
    const signal = new AbortController().signal;
    await fetchApi('/api/x', noToken, { method: 'POST', body: '{"a":1}', json: true, signal });
    expect(mockFetch).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      method: 'POST',
      body: '{"a":1}',
      signal,
    }));
  });
});
