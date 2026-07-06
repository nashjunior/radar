/**
 * Mapa DomainError → HTTP.
 *
 * Semântica da borda (A10 §6, A17 §5.3):
 *   - Nunca vazar stack trace ou PII em produção.
 *   - `code` estável exposto para que clientes possam discriminar erros.
 *   - Regra cross-tenant: erros de authz retornam 403 sem detalhar o motivo.
 */

import type { Context } from 'hono';
import { DomainError } from '@radar/kernel';

export interface ErroApiPayload {
  code: string;
  mensagem: string;
}

/**
 * Códigos de DomainError que mapeiam para 404.
 * Adicione aqui os códigos conforme os módulos forem implementados.
 */
const NOT_FOUND_CODES = new Set([
  'TRIAGEM_NAO_ENCONTRADA',
  'EDITAL_NAO_ENCONTRADO',
  'ALERTA_NAO_ENCONTRADO',
]);

/**
 * Códigos que mapeiam para 403 (autorizacao por objeto).
 * 403 retorna payload vazio — nunca revela o motivo ao cliente.
 */
const FORBIDDEN_CODES = new Set([
  'ACESSO_NEGADO',
  'TENANT_INCORRETO',
]);

/**
 * Converte um erro desconhecido em resposta HTTP JSON.
 * Nunca vaza stack ou mensagem interna em produção.
 */
export function responderErro(c: Context, err: unknown): Response {
  if (err instanceof DomainError) {
    if (FORBIDDEN_CODES.has(err.code)) {
      // 403 vazio — authz por objeto nunca revela contexto (A17 §5.3)
      return c.json<ErroApiPayload>(
        { code: 'ACESSO_NEGADO', mensagem: 'Acesso negado.' },
        403,
      );
    }

    if (NOT_FOUND_CODES.has(err.code)) {
      return c.json<ErroApiPayload>(
        { code: err.code, mensagem: 'Recurso não encontrado.' },
        404,
      );
    }

    return c.json<ErroApiPayload>(
      { code: err.code, mensagem: 'Erro de domínio.' },
      422,
    );
  }

  const isDev = process.env['NODE_ENV'] !== 'production';

  return c.json<ErroApiPayload>(
    {
      code: 'ERRO_INTERNO',
      mensagem: isDev && err instanceof Error ? err.message : 'Erro interno.',
    },
    500,
  );
}
