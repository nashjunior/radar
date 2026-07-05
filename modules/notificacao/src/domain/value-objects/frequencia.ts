import { PreferenciaInvalidaError } from '../errors/index.js';

export type FrequenciaTipo = 'IMEDIATA' | 'DIARIA' | 'SEMANAL';

const FREQUENCIAS_VALIDAS: FrequenciaTipo[] = ['IMEDIATA', 'DIARIA', 'SEMANAL'];

export class Frequencia {
  private constructor(readonly tipo: FrequenciaTipo) {}

  static criar(tipo: string): Frequencia {
    if (!(FREQUENCIAS_VALIDAS as string[]).includes(tipo))
      throw new PreferenciaInvalidaError(`frequência inválida: ${tipo}`);
    return new Frequencia(tipo as FrequenciaTipo);
  }

  get ehImediata(): boolean {
    return this.tipo === 'IMEDIATA';
  }

  equals(other: Frequencia): boolean {
    return this.tipo === other.tipo;
  }

  toString(): string {
    return this.tipo;
  }
}
