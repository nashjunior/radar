import { DomainError } from '@radar/kernel';

class CicloDeFaturamentoInvalidoError extends DomainError {
  readonly code = 'CICLO_DE_FATURAMENTO_INVALIDO' as const;
  constructor(motivo: string) {
    super(`ciclo de faturamento inválido: ${motivo}`);
  }
}

/**
 * VO imutável: janela vigente do ciclo de cobrança de uma Assinatura (`periodoInicio`/
 * `periodoFim`, docs/12 ERD). `renovarCiclo` troca a instância inteira — nunca muta
 * `inicio`/`fim` de um ciclo já vigente.
 */
export class CicloDeFaturamento {
  private constructor(
    readonly inicio: Date,
    readonly fim: Date,
  ) {}

  static criar(inicio: Date, fim: Date): CicloDeFaturamento {
    if (!(inicio instanceof Date) || Number.isNaN(inicio.getTime())) {
      throw new CicloDeFaturamentoInvalidoError('inicio não é uma data válida');
    }
    if (!(fim instanceof Date) || Number.isNaN(fim.getTime())) {
      throw new CicloDeFaturamentoInvalidoError('fim não é uma data válida');
    }
    if (fim <= inicio) {
      throw new CicloDeFaturamentoInvalidoError('fim deve ser posterior a inicio');
    }
    return new CicloDeFaturamento(inicio, fim);
  }

  contem(data: Date): boolean {
    return data >= this.inicio && data < this.fim;
  }

  equals(other: CicloDeFaturamento): boolean {
    return this.inicio.getTime() === other.inicio.getTime() && this.fim.getTime() === other.fim.getTime();
  }
}
