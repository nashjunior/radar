import type { MiddlewareHandler } from 'hono';
import {
  comCorrelacao,
  criarLogger,
  extrairOuGerarTraceId,
  redigirParaLog,
  redigirTextoParaLog,
  redigirUrlParaLog,
  type EscritorDeLog,
  type SaidaLog,
} from '@radar/observabilidade';

export { redigirParaLog, redigirTextoParaLog, redigirUrlParaLog };
export type { SaidaLog };

const loggerPadrao = criarLogger('api');

/**
 * Middleware HTTP (A18 §3.1, §4) — lê o `traceparent` do cliente (dado não
 * confiável: só aceito se casar com o formato W3C estrito; qualquer outra
 * coisa descarta e gera um trace novo, nunca ecoa o valor recebido), abre o
 * escopo de correlação da requisição inteira e loga em JSON Lines ao final.
 * `escrever` é injetável só para teste — em produção vai para stdout/stderr.
 */
export function criarLoggerHttpSeguro(escrever?: EscritorDeLog): MiddlewareHandler {
  const log = escrever ? criarLogger('api', escrever) : loggerPadrao;

  return async (c, next) => {
    const correlationId = extrairOuGerarTraceId(c.req.header('traceparent'));

    await comCorrelacao(correlationId, async () => {
      const inicio = Date.now();
      const url = redigirUrlParaLog(c.req.url);

      try {
        await next();
      } catch (err) {
        const duracaoMs = Date.now() - inicio;
        log.error('http.request', `${c.req.method} ${url} 500`, {
          method: c.req.method,
          url,
          status: 500,
          duracaoMs,
        });
        throw err;
      }

      const duracaoMs = Date.now() - inicio;
      const status = c.res.status;
      const registrar = status >= 500 ? log.error : log.info;
      registrar('http.request', `${c.req.method} ${url} ${status}`, {
        method: c.req.method,
        url,
        status,
        duracaoMs,
      });
    });
  };
}
