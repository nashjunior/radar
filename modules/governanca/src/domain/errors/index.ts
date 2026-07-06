import { DomainError } from '@radar/kernel';

/**
 * Lançado quando o AuditLogRepository não consegue gravar o registro.
 * Operação fail-closed: o caller deve interromper a operação sensível (AB13/P-61).
 */
export class AuditoriaIndisponivelError extends DomainError {
  readonly code = 'AUDITORIA_INDISPONIVEL' as const;
  constructor() {
    super('trilha de auditoria indisponível — operação sensível interrompida (fail-closed)');
  }
}

/** Lançado quando baseLegal está ausente ou vazio (docs/05 §5/§8 — base legal obrigatória). */
export class AuditoriaBaseLegalInvalidaError extends DomainError {
  readonly code = 'AUDITORIA_BASE_LEGAL_INVALIDA' as const;
  constructor() {
    super('baseLegal é obrigatória para registrar evento auditável (docs/05 §5)');
  }
}
