import type { RegistroAuditoria } from '../domain/entities/registro-auditoria.js';

/** Persiste registros de auditoria. Implementação deve ser append-only (imutável). */
export interface AuditLogRepository {
  registrar(registro: RegistroAuditoria, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs para AuditLogId. */
export interface AuditLogIdProvider {
  gerar(): string;
}
