import type { AuditLogId, RegistroAuditoria } from '../domain/entities/registro-auditoria.js';

/** Persiste registros de auditoria. Implementação deve ser append-only (imutável). */
export interface AuditLogRepository {
  registrar(registro: RegistroAuditoria, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs para AuditLogId. A construção do branded type ocorre na infra. */
export interface AuditLogIdProvider {
  gerar(): AuditLogId;
}

/** Relógio da aplicação — injetável para testes determinísticos. */
export interface Clock {
  agora(): Date;
}
