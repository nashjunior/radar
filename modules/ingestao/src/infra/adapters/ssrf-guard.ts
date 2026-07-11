import { lookup } from 'node:dns/promises';
import { UrlBloqueadaPorSsrfError } from '../../domain/errors/index.js';

// ---------------------------------------------------------------------------
// Ranges privados/reservados IPv4 bloqueados (P-58, AB7/AB8)
// ---------------------------------------------------------------------------

interface CidrV4 { base: number; mask: number }

function ipv4ToBits(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let bits = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    bits = (bits << 8) | n;
  }
  return bits >>> 0;
}

function parseCidrV4(cidr: string): CidrV4 {
  const [base, prefixStr] = cidr.split('/') as [string, string];
  const prefix = parseInt(prefixStr, 10);
  const baseBits = ipv4ToBits(base)!;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: baseBits & mask, mask };
}

function inCidrV4(addr: string, cidr: CidrV4): boolean {
  const bits = ipv4ToBits(addr);
  if (bits === null) return false;
  return (bits & cidr.mask) === cidr.base;
}

// RFC 1918, loopback, link-local (inclui metadata AWS/GCP), broadcast, etc.
const BLOCKED_V4_CIDRS: CidrV4[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '0.0.0.0/8',
  '100.64.0.0/10',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '240.0.0.0/4',
  '255.255.255.255/32',
].map(parseCidrV4);

// ---------------------------------------------------------------------------
// IPv6 bloqueado
// ---------------------------------------------------------------------------

const BLOCKED_V6_PREFIXES = [
  '::1',           // loopback
  '::',            // unspecified
  'fc',            // ULA (fc00::/7 — fc e fd)
  'fd',
  'fe80',          // link-local (fe80::/10)
  '::ffff:',       // IPv4-mapped
  '64:ff9b:',      // IPv4-IPv6 translation (RFC 6052)
];

function isBlockedV6(addr: string): boolean {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::1' || lower === '::') return true;
  return BLOCKED_V6_PREFIXES.some(prefix => lower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isIPv6Literal(hostname: string): boolean {
  return hostname.startsWith('[') || hostname.includes(':');
}

function isBlockedIP(addr: string): boolean {
  const clean = addr.replace(/^\[|\]$/g, '');
  if (isIPv4Literal(clean)) {
    return BLOCKED_V4_CIDRS.some(cidr => inCidrV4(clean, cidr));
  }
  return isBlockedV6(clean);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SsrfGuardConfig {
  /** Hosts/domínios autorizados a receber egress (fail-closed: fora da lista = bloqueado). */
  allowedHosts: readonly string[];
  /** Limite de redirects manuais. Default: 5. */
  maxRedirects?: number;
}

/**
 * Guarda SSRF para fetch de URLs externas de fontes não confiáveis (P-58, AB7/AB8).
 *
 * Ordem de verificação:
 *   1. Scheme: somente http/https.
 *   2. IP literal: rejeita qualquer IP privado/loopback/link-local/metadata.
 *   3. Allowlist de egress (fail-closed): host fora da lista = bloqueado.
 *   4. Resolução DNS: o IP resolvido é verificado contra ranges privados
 *      (defesa em profundidade contra DNS rebinding).
 *
 * O fetch manual de redirects revalida cada hop — nenhum redirect para destino
 * interno passa despercebido.
 */
export class SsrfGuard {
  private readonly maxRedirects: number;

  constructor(private readonly config: SsrfGuardConfig) {
    this.maxRedirects = config.maxRedirects ?? 5;
  }

  /**
   * Valida a URL e rejeita com UrlBloqueadaPorSsrfError se não passa nas
   * verificações de scheme, IP privado, allowlist e DNS.
   */
  async validarUrl(urlStr: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      throw new UrlBloqueadaPorSsrfError(urlStr, 'URL malformada');
    }

    // 1. Scheme
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UrlBloqueadaPorSsrfError(urlStr, `scheme não permitido: ${url.protocol}`);
    }

    const hostname = url.hostname;

    // 2. IP literal → verifica ranges bloqueados (independe da allowlist)
    if (isIPv4Literal(hostname) || isIPv6Literal(hostname)) {
      if (isBlockedIP(hostname)) {
        throw new UrlBloqueadaPorSsrfError(urlStr, `IP privado/loopback/link-local bloqueado: ${hostname}`);
      }
      // IP público: ainda precisa estar na allowlist
    }

    // 3. Allowlist de egress (fail-closed)
    if (!this.hostnamePermitido(hostname)) {
      throw new UrlBloqueadaPorSsrfError(urlStr, `host '${hostname}' fora da allowlist de egress`);
    }

    // 4. Resolução DNS (apenas para hostnames — não IPs literais)
    if (!isIPv4Literal(hostname) && !isIPv6Literal(hostname)) {
      let resolvedAddr: string;
      try {
        const result = await lookup(hostname, { hints: 0 });
        resolvedAddr = result.address;
      } catch {
        throw new UrlBloqueadaPorSsrfError(urlStr, `falha ao resolver DNS de '${hostname}' (fail-closed)`);
      }
      if (isBlockedIP(resolvedAddr)) {
        throw new UrlBloqueadaPorSsrfError(
          urlStr,
          `host '${hostname}' resolve para IP privado/loopback: ${resolvedAddr}`,
        );
      }
    }
  }

  /**
   * Faz o fetch com redirecionamento manual, revalidando cada Location header.
   * Lança UrlBloqueadaPorSsrfError se qualquer hop levar a destino bloqueado.
   */
  async fetch(urlStr: string, signal: AbortSignal): Promise<Response> {
    let currentUrl = urlStr;

    for (let hops = 0; ; hops++) {
      await this.validarUrl(currentUrl);

      const resp = await globalThis.fetch(currentUrl, { signal, redirect: 'manual' });

      if (resp.status < 300 || resp.status >= 400) {
        return resp;
      }

      if (hops >= this.maxRedirects) {
        throw new UrlBloqueadaPorSsrfError(
          currentUrl,
          `limite de redirects excedido (máximo: ${this.maxRedirects})`,
        );
      }

      const location = resp.headers.get('location');
      if (!location) {
        throw new UrlBloqueadaPorSsrfError(currentUrl, 'redirect sem header Location');
      }

      currentUrl = new URL(location, currentUrl).toString();
    }
  }

  // ---------------------------------------------------------------------------
  // Privado
  // ---------------------------------------------------------------------------

  private hostnamePermitido(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return this.config.allowedHosts.some(allowed => {
      const a = allowed.toLowerCase();
      return h === a || h.endsWith(`.${a}`);
    });
  }
}
