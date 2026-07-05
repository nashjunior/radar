import { ConfiancaInvalidaError } from '../errors/index.js';

/**
 * Confiança de extração ∈ [0,1] (A17 §3.1, docs/10 §4). Política de limiar por campo é [A VALIDAR]
 * → P-19, calibrada contra o gold set (A16 §2.4).
 */
export class Confianca {
  private constructor(readonly valor: number) {}

  static criar(valor: number): Confianca {
    if (valor < 0 || valor > 1) throw new ConfiancaInvalidaError(valor);
    return new Confianca(valor);
  }

  suficiente(limiar: number): boolean {
    return this.valor >= limiar;
  }

  /** A confiança agregada é a MENOR entre os campos críticos (docs/10 §4). */
  static menor(a: Confianca, b: Confianca): Confianca {
    return a.valor <= b.valor ? a : b;
  }

  equals(outra: Confianca): boolean {
    return this.valor === outra.valor;
  }
}
