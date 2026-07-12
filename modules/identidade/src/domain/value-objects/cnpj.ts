import { CnpjInvalidoError } from '../errors.js';

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function calcularDigitoVerificador(digitos: readonly number[], pesos: readonly number[]): number {
  const soma = digitos.reduce((acc, d, i) => acc + d * pesos[i]!, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * VO imutável: CNPJ do Tenant (docs/14 §6, P-109 L3). `criar` normaliza
 * (remove máscara) e valida os dois dígitos verificadores — defesa de entrada
 * no onboarding self-signup (dado de fronteira, nunca confiado do formulário).
 * Checagem de CNPJ **ativo na Receita** é P-23 (higiene de cadastro), fora
 * desta VO — aqui é só a validade estrutural do número.
 */
export class Cnpj {
  private constructor(readonly valor: string) {}

  static criar(raw: string): Cnpj {
    const normalizado = raw.replace(/\D/g, '');

    if (normalizado.length !== 14) {
      throw new CnpjInvalidoError(`esperado 14 dígitos, recebido ${normalizado.length}`);
    }
    if (/^(\d)\1{13}$/.test(normalizado)) {
      throw new CnpjInvalidoError('todos os dígitos iguais');
    }

    const digitos = normalizado.split('').map(Number);
    const dv1 = calcularDigitoVerificador(digitos.slice(0, 12), PESOS_DV1);
    if (dv1 !== digitos[12]) {
      throw new CnpjInvalidoError('primeiro dígito verificador não confere');
    }
    const dv2 = calcularDigitoVerificador(digitos.slice(0, 13), PESOS_DV2);
    if (dv2 !== digitos[13]) {
      throw new CnpjInvalidoError('segundo dígito verificador não confere');
    }

    return new Cnpj(normalizado);
  }

  equals(other: Cnpj): boolean {
    return this.valor === other.valor;
  }

  toString(): string {
    return this.valor;
  }
}
