import type { MiddlewareHandler } from 'hono';
import { DomainError } from '@radar/kernel';

const VALOR_REDACTED = '[REDACTED]';

const CHAVES_SENSIVEIS = /authorization|cookie|token|secret|segredo|senha|password|api[-_]?key|cpf|cnpj|email/i;
const PADROES_SENSIVEIS: readonly RegExp[] = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\b(?:api[-_]?key|token|secret|segredo|senha|password)=([^&\s]+)/gi,
];

export type SaidaLog = string | number | boolean | null | SaidaLog[] | { readonly [key: string]: SaidaLog };

export function redigirTextoParaLog(valor: string): string {
  return PADROES_SENSIVEIS.reduce(
    (texto, padrao) => texto.replace(padrao, VALOR_REDACTED),
    valor,
  );
}

export function redigirUrlParaLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const pathname = redigirTextoParaLog(url.pathname);
    if (!url.search) return pathname;

    const params = [...url.searchParams.keys()].map((chave) => {
      const chaveSegura = redigirTextoParaLog(chave);
      return `${encodeURIComponent(chaveSegura)}=${VALOR_REDACTED}`;
    });

    return `${pathname}?${params.join('&')}`;
  } catch {
    return redigirTextoParaLog(rawUrl);
  }
}

export function redigirParaLog(valor: unknown, profundidade = 0): SaidaLog {
  if (valor === null) return null;

  if (valor instanceof Error) {
    const saida: Record<string, SaidaLog> = { tipo: valor.name };
    if (valor instanceof DomainError) saida['code'] = valor.code;
    return saida;
  }

  if (typeof valor === 'string') return redigirTextoParaLog(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'undefined' || typeof valor === 'symbol' || typeof valor === 'function') {
    return String(valor);
  }

  if (profundidade >= 4) return '[Objeto]';

  if (Array.isArray(valor)) {
    return valor.map((item) => redigirParaLog(item, profundidade + 1));
  }

  const saida: Record<string, SaidaLog> = {};
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = CHAVES_SENSIVEIS.test(chave)
      ? VALOR_REDACTED
      : redigirParaLog(item, profundidade + 1);
  }
  return saida;
}

export function criarLoggerHttpSeguro(log: (mensagem: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const inicio = Date.now();

    try {
      await next();
    } catch (err) {
      const duracaoMs = Date.now() - inicio;
      log(`[API] ${c.req.method} ${redigirUrlParaLog(c.req.url)} 500 ${duracaoMs}ms`);
      throw err;
    }

    const duracaoMs = Date.now() - inicio;
    log(`[API] ${c.req.method} ${redigirUrlParaLog(c.req.url)} ${c.res.status} ${duracaoMs}ms`);
  };
}
