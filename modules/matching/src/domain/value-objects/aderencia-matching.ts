import { AderenciaMatchingInvalidaError } from '../errors/index.js';

/**
 * Aderência no sentido de matching: quão relevante é o edital para o critério.
 * Diferente da Aderência de Triagem (docs/13 §3, P-45) — não misturar.
 * Postura recall-alto (docs/11 §2): limiar baixo intencionalmente.
 */
export class AderenciaMatching {
  private constructor(readonly valor: number) {}

  static criar(valor: number): AderenciaMatching {
    if (!Number.isFinite(valor) || valor < 0 || valor > 1) throw new AderenciaMatchingInvalidaError(valor);
    return new AderenciaMatching(valor);
  }

  /** Limiar mínimo para gerar alerta (P-21 — [A VALIDAR]). */
  get superaLimiar(): boolean {
    return this.valor >= 0.3;
  }

  get ehAlta(): boolean {
    return this.valor >= 0.7;
  }

  equals(other: AderenciaMatching): boolean {
    return this.valor === other.valor;
  }

  toString(): string {
    return this.valor.toFixed(4);
  }
}
