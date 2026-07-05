import { AderenciaInvalidaError } from '../errors/index.js';

/**
 * Aderência de TRIAGEM ∈ [0,1]: quão apta a empresa está para o edital (por perfil, por IA).
 * NÃO confundir com a AderenciaMatching (A15 §3.1, docs/13 §3, P-45) — mesmo termo, modelos distintos.
 */
export class Aderencia {
  private constructor(readonly valor: number) {}

  static criar(valor: number): Aderencia {
    if (valor < 0 || valor > 1) throw new AderenciaInvalidaError(valor);
    return new Aderencia(valor);
  }

  /**
   * Limiar de "go" é sugestão; a decisão é sempre do usuário (HITL — docs/10 §4).
   * O corte exato é [A VALIDAR] → P-19.
   */
  get ehAlta(): boolean {
    return this.valor >= 0.7;
  }

  equals(outra: Aderencia): boolean {
    return this.valor === outra.valor;
  }
}
