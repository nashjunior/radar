/**
 * Classe-base de todos os erros de domínio do Radar.
 * Carrega um `code` estável (mapeado para HTTP/gRPC na borda — A10 §6).
 * Nunca vaza stack ou PII para o cliente.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Preserva a prototype chain no transpile para ES5+
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Acesso negado (IDOR / cross-tenant). Mapeado para 403 / PERMISSION_DENIED. */
export class AcessoNegadoError extends DomainError {
  readonly code = 'ACESSO_NEGADO' as const;
  constructor() {
    super('acesso negado ao recurso solicitado');
  }
}
