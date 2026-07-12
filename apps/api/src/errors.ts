/**
 * Mapa DomainError → HTTP.
 *
 * Semântica da borda (A10 §6, A17 §5.3):
 *   - Nunca vazar stack trace, mensagem interna ou PII.
 *   - `code` estável exposto para que clientes possam discriminar erros.
 *   - Regra cross-tenant: erros de authz retornam 403 sem detalhar o motivo.
 */

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError } from '@radar/kernel';

export interface ErroApiPayload {
  code: string;
  mensagem: string;
}

/**
 * Códigos de DomainError que mapeiam para HTTP na borda.
 * O mapeamento é por `code` estável para não acoplar a API aos módulos.
 */
const HTTP_STATUS_BY_CODE = new Map<string, ContentfulStatusCode>([
  ['ACESSO_NEGADO', 403],
  ['TENANT_INCORRETO', 403],

  ['TRIAGEM_NAO_ENCONTRADA', 404],
  ['EDITAL_NAO_ENCONTRADO', 404],
  ['ALERTA_NAO_ENCONTRADO', 404],
  ['PERFIL_NAO_ENCONTRADO', 404],
  ['OBJETO_NAO_ENCONTRADO', 404],

  ['CONFIANCA_INSUFICIENTE', 422],
  ['OCR_FALHOU', 422],
  ['EXTRACAO_RECUSADA', 422],
  ['ANEXO_NAO_LIMPO', 422],
  ['CANAL_INVALIDO', 422],
  ['PREFERENCIA_INVALIDA', 422],

  ['SAIDA_LLM_INVALIDA', 502],

  ['FONTE_INDISPONIVEL', 503],
  ['ANEXO_INDISPONIVEL', 503],
  ['LOTE_EXTRACAO_INDISPONIVEL', 503],
  ['CANAL_INDISPONIVEL', 503],
  ['AUDITORIA_INDISPONIVEL', 503],

  ['PAGAMENTO_GATEWAY_INDISPONIVEL', 503],
]);

const MENSAGEM_POR_STATUS = new Map<ContentfulStatusCode, string>([
  [400, 'Requisição inválida.'],
  [403, 'Acesso negado.'],
  [404, 'Recurso não encontrado.'],
  [422, 'Erro de domínio.'],
  [502, 'Falha temporária de integração.'],
  [503, 'Serviço temporariamente indisponível.'],
]);

/**
 * Converte um erro desconhecido em resposta HTTP JSON.
 * Nunca vaza stack ou mensagem interna.
 */
export function responderErro(c: Context, err: unknown): Response {
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const mensagem = MENSAGEM_POR_STATUS.get(status) ?? 'Requisição inválida.';
    const code = status === 403 ? 'ACESSO_NEGADO' : 'ERRO_HTTP';

    return c.json<ErroApiPayload>({ code, mensagem }, status);
  }

  if (err instanceof DomainError) {
    const status = HTTP_STATUS_BY_CODE.get(err.code) ?? 400;
    const code = status === 403 ? 'ACESSO_NEGADO' : err.code;
    const mensagem = MENSAGEM_POR_STATUS.get(status) ?? 'Erro de domínio.';

    return c.json<ErroApiPayload>(
      { code, mensagem },
      status,
    );
  }

  return c.json<ErroApiPayload>(
    {
      code: 'ERRO_INTERNO',
      mensagem: 'Erro interno.',
    },
    500,
  );
}
