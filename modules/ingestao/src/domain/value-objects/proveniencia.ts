import { ProvenienciaInvalidaError } from '../errors/index.js';

/**
 * VO de proveniência: origem e base legal de cada edital coletado.
 * Obrigatória em todo edital (docs/02, §4; docs/05, §5).
 * Invariantes: fonte e baseLegal não-vazias; coletadoEm é uma Date válida e finita.
 */
export class Proveniencia {
  private constructor(
    readonly fonte: string,
    readonly baseLegal: string,
    readonly coletadoEm: Date,
  ) {}

  static criar(params: {
    fonte: string;
    baseLegal: string;
    coletadoEm: Date;
  }): Proveniencia {
    if (!params.fonte.trim()) throw new ProvenienciaInvalidaError('fonte');
    if (!params.baseLegal.trim()) throw new ProvenienciaInvalidaError('baseLegal');
    if (!Number.isFinite(params.coletadoEm.getTime())) throw new ProvenienciaInvalidaError('coletadoEm');
    return new Proveniencia(params.fonte.trim(), params.baseLegal.trim(), params.coletadoEm);
  }

  equals(other: Proveniencia): boolean {
    return (
      this.fonte === other.fonte &&
      this.baseLegal === other.baseLegal &&
      this.coletadoEm.getTime() === other.coletadoEm.getTime()
    );
  }

  toString(): string {
    return `${this.fonte} | ${this.baseLegal} | ${this.coletadoEm.toISOString()}`;
  }
}
