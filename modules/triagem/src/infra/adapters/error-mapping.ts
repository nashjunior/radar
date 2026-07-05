import { AcessoNegadoError, DomainError } from '@radar/kernel';
import {
  ConfiancaInsuficienteError,
  ExtracaoRecusadaError,
  LoteExtracaoIndisponivelError,
  OcrFalhouError,
  PerfilNaoEncontradoError,
  SaidaLlmInvalidaError,
} from '../../domain/errors/index.js';

/**
 * Mapeia erros de domínio para status HTTP na borda (A17 §5.3, A10 §4.6/§6). O núcleo nunca conhece
 * HTTP/gRPC; a resposta nunca vaza stack/PII (AB11 / P-61). `AcessoNegadoError` colapsa IDOR e
 * cross-tenant no mesmo 403 — não revela existência do recurso.
 */
export function paraHttpStatus(err: unknown): number {
  if (err instanceof AcessoNegadoError) return 403; // IDOR/cross-tenant (P-51)
  if (err instanceof PerfilNaoEncontradoError) return 404;
  if (err instanceof ConfiancaInsuficienteError) return 422; // → leitura assistida (docs/10 §6)
  if (err instanceof OcrFalhouError) return 422; // → leitura manual
  if (err instanceof ExtracaoRecusadaError) return 422; // modelo recusou → leitura manual (RAD-55)
  if (err instanceof SaidaLlmInvalidaError) return 502; // falha do provedor, sem vazar detalhe
  if (err instanceof LoteExtracaoIndisponivelError) return 503; // transporte do lote indisponível (RAD-54)
  if (err instanceof DomainError) return 400;
  return 500; // nunca vaza stack/PII (AB11 / P-61)
}
