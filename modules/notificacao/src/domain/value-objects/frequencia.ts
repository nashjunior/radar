import { PreferenciaInvalidaError } from '../errors/index.js';

export type FrequenciaTipo = 'IMEDIATA' | 'DIARIA' | 'SEMANAL';

const FREQUENCIAS_VALIDAS: FrequenciaTipo[] = ['IMEDIATA', 'DIARIA', 'SEMANAL'];

/** Cap de itens no digest por frequência — decisão de Produto P-81 (docs/11 §4). */
export const CAP_DIGEST: Record<'DIARIA' | 'SEMANAL', number> = {
  DIARIA: 10,
  SEMANAL: 25,
};

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
