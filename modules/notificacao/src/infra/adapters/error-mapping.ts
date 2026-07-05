import { AcessoNegadoError, DomainError } from '@radar/kernel';
import {
  CanalIndisponivelError,
  CanalInvalidoError,
  PreferenciaInvalidaError,
} from '../../domain/errors/index.js';

/** Mapeia DomainErrors para status HTTP sem vazar stack/PII (P-61). */
export function paraHttpStatus(err: unknown): number {
  if (err instanceof AcessoNegadoError) return 403;
  if (err instanceof CanalIndisponivelError) return 503;
  if (err instanceof CanalInvalidoError) return 400;
  if (err instanceof PreferenciaInvalidaError) return 400;
  if (err instanceof DomainError) return 400;
  return 500;
}
