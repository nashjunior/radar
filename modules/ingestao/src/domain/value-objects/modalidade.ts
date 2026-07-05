import { DomainError } from '@radar/kernel';

class ModalidadeInvalidaError extends DomainError {
  readonly code = 'MODALIDADE_INVALIDA' as const;
  constructor(codigo: number) {
    super(`código de modalidade inválido: ${codigo}`);
  }
}

/**
 * Modalidade de contratação da Lei 14.133/2021.
 * Códigos definidos na tabela de domínio do PNCP. [A VALIDAR — Swagger]
 */
export class Modalidade {
  private constructor(
    readonly codigo: number,
    readonly nome: string,
  ) {}

  static criar(codigo: number, nome: string): Modalidade {
    if (!Number.isInteger(codigo) || codigo <= 0) {
      throw new ModalidadeInvalidaError(codigo);
    }
    return new Modalidade(codigo, nome.trim());
  }

  equals(other: Modalidade): boolean {
    return this.codigo === other.codigo;
  }

  toString(): string {
    return `${this.codigo} — ${this.nome}`;
  }
}
