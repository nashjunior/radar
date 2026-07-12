import { DomainError } from '@radar/kernel';

class CotaMensalInvalidaError extends DomainError {
  readonly code = 'COTA_MENSAL_INVALIDA' as const;
  constructor(valor: number) {
    super(`cota mensal inválida: ${valor} (esperado inteiro > 0)`);
  }
}

/**
 * VO imutável: quantidade de triagens que o plano comercial dá ao Tenant no ciclo
 * (docs/06 — "Cota de triagens"; docs/13 §3/§4). É o teto que a reserva atômica
 * na borda compara (P-107 (3)) — nunca a cota do provedor de nuvem nem a cota
 * reservada ME/EPP da Lei 14.133/2021.
 */
export class CotaMensal {
  private constructor(readonly valor: number) {}

  static criar(valor: number): CotaMensal {
    if (!Number.isInteger(valor) || valor <= 0) throw new CotaMensalInvalidaError(valor);
    return new CotaMensal(valor);
  }

  equals(other: CotaMensal): boolean {
    return this.valor === other.valor;
  }
}
