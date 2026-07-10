import { DomainError } from '@radar/kernel';

// AuditoriaIndisponivelError promovida ao @radar/kernel — compartilhada entre contextos (AB13/P-61).
export { AuditoriaIndisponivelError } from '@radar/kernel';

/** Lançado quando baseLegal está ausente ou vazio (docs/05 §5/§8 — base legal obrigatória). */
export class AuditoriaBaseLegalInvalidaError extends DomainError {
  readonly code = 'AUDITORIA_BASE_LEGAL_INVALIDA' as const;
  constructor() {
    super('baseLegal é obrigatória para registrar evento auditável (docs/05 §5)');
  }
}
