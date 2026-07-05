import { DomainError } from '@radar/kernel';

class NumeroControlePncpInvalidoError extends DomainError {
  readonly code = 'NUMERO_CONTROLE_PNCP_INVALIDO' as const;
  constructor(valor: string) {
    super(`numeroControlePNCP inválido: '${valor}'`);
  }
}

/** VO imutável que encapsula o identificador único de uma contratação no PNCP. */
export class NumeroControlePncp {
  private constructor(readonly valor: string) {}

  static criar(valor: string): NumeroControlePncp {
    const v = valor?.trim();
    if (!v) throw new NumeroControlePncpInvalidoError(valor ?? '');
    return new NumeroControlePncp(v);
  }

  equals(other: NumeroControlePncp): boolean {
    return this.valor === other.valor;
  }

  toString(): string {
    return this.valor;
  }
}
