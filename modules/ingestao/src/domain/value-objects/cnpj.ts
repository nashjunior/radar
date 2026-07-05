import { DomainError } from '@radar/kernel';

class CnpjInvalidoError extends DomainError {
  readonly code = 'CNPJ_INVALIDO' as const;
  constructor(valor: string) {
    super(`CNPJ inválido: '${valor}'`);
  }
}

/**
 * VO imutável que encapsula e valida um CNPJ.
 * Armazena apenas os 14 dígitos; formatação sob demanda.
 * Validação inclui check digits (algoritmo oficial Receita Federal).
 */
export class Cnpj {
  private constructor(readonly valor: string) {}

  static criar(valor: string): Cnpj {
    const digitos = valor.replace(/\D/g, '');
    if (!validarCnpj(digitos)) throw new CnpjInvalidoError(valor);
    return new Cnpj(digitos);
  }

  /** Retorna no formato XX.XXX.XXX/XXXX-XX. */
  formatado(): string {
    return this.valor.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5',
    );
  }

  equals(other: Cnpj): boolean {
    return this.valor === other.valor;
  }

  toString(): string {
    return this.formatado();
  }
}

function validarCnpj(d: string): boolean {
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const calcDigito = (digitos: string, pesos: readonly number[]): number => {
    const soma = pesos.reduce((acc, p, i) => acc + Number(digitos[i]) * p, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

  return (
    calcDigito(d, pesos1) === Number(d[12]) &&
    calcDigito(d, pesos2) === Number(d[13])
  );
}
