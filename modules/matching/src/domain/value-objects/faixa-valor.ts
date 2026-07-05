import { FaixaValorInvalidaError } from '../errors/index.js';

/**
 * Faixas de valor definidas por decreto (docs/02 §2, docs/11 §5).
 * NUNCA representar como constante no código — lida de tabela parametrizável e datada.
 */
export class FaixaValor {
  private constructor(
    readonly min: number | null,
    readonly max: number | null,
  ) {}

  static criar(min: number | null, max: number | null): FaixaValor {
    if (min !== null && !Number.isFinite(min)) throw new FaixaValorInvalidaError(min, max ?? min);
    if (max !== null && !Number.isFinite(max)) throw new FaixaValorInvalidaError(min ?? max, max);
    if (min !== null && max !== null && min > max)
      throw new FaixaValorInvalidaError(min, max);
    return new FaixaValor(min, max);
  }

  abrange(valor: number): boolean {
    if (!Number.isFinite(valor)) return false;
    const acimaDoPiso = this.min === null || valor >= this.min;
    const abaixoDoTeto = this.max === null || valor <= this.max;
    return acimaDoPiso && abaixoDoTeto;
  }

  equals(other: FaixaValor): boolean {
    return this.min === other.min && this.max === other.max;
  }

  toString(): string {
    const piso = this.min !== null ? `R$${this.min}` : 'sem piso';
    const teto = this.max !== null ? `R$${this.max}` : 'sem teto';
    return `[${piso} – ${teto}]`;
  }
}
