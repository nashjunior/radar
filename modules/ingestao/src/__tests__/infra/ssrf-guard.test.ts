import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrfGuard } from '../../infra/adapters/ssrf-guard.js';
import { UrlBloqueadaPorSsrfError } from '../../domain/errors/index.js';

// ---------------------------------------------------------------------------
// Mock do módulo de DNS — evita resolução real em testes
// ---------------------------------------------------------------------------

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';

const mockLookup = lookup as ReturnType<typeof vi.fn>;

/** Guard com allowlist minimal para os testes. */
const ALLOWED = ['pncp.gov.br', 'comprasnet.gov.br'];

function criarGuard(allowedHosts = ALLOWED): SsrfGuard {
  return new SsrfGuard({ allowedHosts, maxRedirects: 3 });
}

// ---------------------------------------------------------------------------
// AB7/AB8 · Guarda SSRF (P-58)
// ---------------------------------------------------------------------------

describe('SsrfGuard · validarUrl', () => {
  beforeEach(() => {
    mockLookup.mockResolvedValue({ address: '200.10.20.30', family: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Scheme ────────────────────────────────────────────────────────────────

  it('aceita http e https como schemes válidos', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('https://pncp.gov.br/file.pdf')).resolves.toBeUndefined();
    await expect(guard.validarUrl('http://pncp.gov.br/file.pdf')).resolves.toBeUndefined();
  });

  it('rejeita scheme file://', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('file:///etc/passwd')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('rejeita scheme ftp://', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('ftp://pncp.gov.br/file')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── IP literal → loopback ─────────────────────────────────────────────────

  it('bloqueia http://127.0.0.1 (loopback)', async () => {
    const guard = new SsrfGuard({ allowedHosts: ['127.0.0.1'] }); // mesmo na allowlist, IP privado é bloqueado
    await expect(guard.validarUrl('http://127.0.0.1/file.pdf')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://127.0.0.2 (loopback)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://127.0.0.2/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://0.0.0.0 (unspecified)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://0.0.0.0/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── IP literal → metadata (AWS/GCP) ──────────────────────────────────────

  it('bloqueia http://169.254.169.254 (metadata AWS)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://169.254.0.1 (link-local)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://169.254.0.1/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── IP literal → redes privadas ────────────────────────────────────────────

  it('bloqueia http://10.0.0.1 (RFC 1918)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://10.0.0.1/file')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://172.16.0.1 (RFC 1918)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://172.16.0.1/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://192.168.1.100 (RFC 1918)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://192.168.1.100/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── IPv6 privado ──────────────────────────────────────────────────────────

  it('bloqueia http://[::1] (loopback IPv6)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://[::1]/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia http://[fe80::1] (link-local IPv6)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('http://[fe80::1]/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── Allowlist (fail-closed) ────────────────────────────────────────────────

  it('bloqueia host não listado (fail-closed)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('https://evil.com/file.pdf')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia subdomínio de domínio não listado', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('https://sub.evil.com/file')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('aceita subdomínio de host listado', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('https://arquivos.pncp.gov.br/file.pdf')).resolves.toBeUndefined();
  });

  it('bloqueia tentativa de bypass com sufixo (evil.pncp.gov.br.attacker.com)', async () => {
    const guard = criarGuard();
    await expect(guard.validarUrl('https://evil.pncp.gov.br.attacker.com/')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── DNS rebinding ─────────────────────────────────────────────────────────

  it('bloqueia domínio da allowlist que resolve para IP privado (DNS rebinding)', async () => {
    mockLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 });
    const guard = criarGuard();
    await expect(guard.validarUrl('https://pncp.gov.br/file.pdf')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia domínio da allowlist que resolve para loopback', async () => {
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    const guard = criarGuard();
    await expect(guard.validarUrl('https://pncp.gov.br/file.pdf')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  it('bloqueia quando DNS falha (fail-closed)', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const guard = criarGuard();
    await expect(guard.validarUrl('https://pncp.gov.br/file.pdf')).rejects.toThrow(UrlBloqueadaPorSsrfError);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('aceita URL válida com IP público e host na allowlist', async () => {
    mockLookup.mockResolvedValue({ address: '200.10.20.30', family: 4 });
    const guard = criarGuard();
    await expect(guard.validarUrl('https://pncp.gov.br/editais/edital.pdf')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SsrfGuard.fetch — redirect manual com revalidação
// ---------------------------------------------------------------------------

describe('SsrfGuard · fetch com redirects', () => {
  const noop = new AbortController().signal;

  beforeEach(() => {
    mockLookup.mockResolvedValue({ address: '200.10.20.30', family: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bloqueia redirect para IP interno (169.254.169.254)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );

    const guard = criarGuard();
    await expect(guard.fetch('https://pncp.gov.br/file.pdf', noop)).rejects.toThrow(UrlBloqueadaPorSsrfError);
    fetchSpy.mockRestore();
  });

  it('bloqueia redirect para domínio fora da allowlist', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: 'https://evil.com/payload' },
      }),
    );

    const guard = criarGuard();
    await expect(guard.fetch('https://pncp.gov.br/file.pdf', noop)).rejects.toThrow(UrlBloqueadaPorSsrfError);
    fetchSpy.mockRestore();
  });

  it('bloqueia quando excede o limite de redirects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://pncp.gov.br/outro' },
      }),
    );

    const guard = new SsrfGuard({ allowedHosts: ALLOWED, maxRedirects: 2 });
    await expect(guard.fetch('https://pncp.gov.br/file.pdf', noop)).rejects.toThrow(UrlBloqueadaPorSsrfError);
    fetchSpy.mockRestore();
  });

  it('segue redirect legítimo dentro da allowlist e retorna resposta final', async () => {
    const finalResponse = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://arquivos.pncp.gov.br/edital.pdf' } }),
      )
      .mockResolvedValueOnce(finalResponse);

    const guard = criarGuard();
    const resp = await guard.fetch('https://pncp.gov.br/file.pdf', noop);
    expect(resp.status).toBe(200);
    fetchSpy.mockRestore();
  });

  it('retorna resposta diretamente quando não há redirect', async () => {
    const body = new Uint8Array([42]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(body, { status: 200 }),
    );

    const guard = criarGuard();
    const resp = await guard.fetch('https://pncp.gov.br/file.pdf', noop);
    expect(resp.status).toBe(200);
    fetchSpy.mockRestore();
  });
});
