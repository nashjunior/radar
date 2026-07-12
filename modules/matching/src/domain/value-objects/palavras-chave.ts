import { PalavrasChaveVaziaError } from '../errors/index.js';

export class PalavrasChave {
  private constructor(readonly termos: readonly string[]) {}

  static criar(termos: string[]): PalavrasChave {
    const normalizados = termos.map(normalizarTermo).filter(Boolean);
    if (normalizados.length === 0) throw new PalavrasChaveVaziaError();
    return new PalavrasChave(Object.freeze(normalizados));
  }

  equals(other: PalavrasChave): boolean {
    if (this.termos.length !== other.termos.length) return false;
    return this.termos.every((t, i) => t === other.termos[i]);
  }

  toString(): string {
    return this.termos.join(', ');
  }
}

function normalizarTermo(termo: string): string {
  return termo
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
