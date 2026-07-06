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
