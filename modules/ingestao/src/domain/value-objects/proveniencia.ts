/**
 * VO de proveniência: origem e base legal de cada edital coletado.
 * Obrigatória em todo edital (docs/02, §4; docs/05, §5).
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
    return new Proveniencia(params.fonte, params.baseLegal, params.coletadoEm);
  }
}
