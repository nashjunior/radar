/**
 * Contrato mínimo de evento de domínio, comum aos bounded contexts (A03 §3).
 * Par simétrico do `DomainError` (errors.ts) — marker estrutural puro, sem I/O.
 */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}
