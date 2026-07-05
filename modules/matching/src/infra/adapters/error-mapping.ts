import { AcessoNegadoError, DomainError } from '@radar/kernel';
import {
  AderenciaMatchingInvalidaError,
  AlertaNaoEncontradoError,
  CriterioInvalidoError,
} from '../../domain/errors/index.js';

/** Mapeia DomainErrors para status HTTP sem vazar stack/PII (P-61). */
export function paraHttpStatus(err: unknown): number {
  if (err instanceof AcessoNegadoError) return 403;
  if (err instanceof AlertaNaoEncontradoError) return 404;
  if (err instanceof CriterioInvalidoError) return 400;
  if (err instanceof AderenciaMatchingInvalidaError) return 400;
  if (err instanceof DomainError) return 400;
  return 500;
}
