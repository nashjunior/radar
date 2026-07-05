import type { CanalTipo } from './canal.js';

/**
 * Criticidade calculada a partir da proximidade do prazo da proposta (docs/11 §4).
 * Limiar de dias é [A VALIDAR] → P-81.
 */
export class Criticidade {
  private constructor(readonly urgente: boolean) {}

  /** diasAtePrazo = número de dias corridos até o prazo da proposta. */
  static criar(diasAtePrazo: number): Criticidade {
    return new Criticidade(diasAtePrazo <= 3);
  }

  get canalForcado(): CanalTipo {
    return 'EMAIL';
  }

  get exigeImediato(): boolean {
    return this.urgente;
  }

  equals(other: Criticidade): boolean {
    return this.urgente === other.urgente;
  }

  toString(): string {
    return this.urgente ? 'URGENTE' : 'NORMAL';
  }
}
