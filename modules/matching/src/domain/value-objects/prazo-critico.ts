/** Corte de dias corridos até o prazo final para o alerta contar como crítico (P-81, docs/08 §4.1). */
export const DIAS_ATE_PRAZO_CRITICO_PADRAO = 3;

/**
 * Se o edital casado com o critério tem prazo final conhecido em até `diasLimiar` dias
 * corridos (P-81). Alimenta o SLO de error budget zero "0 alertas de prazo crítico
 * perdidos" (docs/08 §4.1, A18 §5.1): usado no OU com `AderenciaMatching.ehAlta` para
 * decidir a imediaticidade do alerta — regra de domínio do Matching, não do worker.
 * null/prazo já vencido nunca é crítico (não há mais o que alertar às pressas).
 */
export class PrazoCritico {
  private constructor(readonly critico: boolean) {}

  /** Calcula a partir do prazo do edital e do instante do casamento (RAD-303). */
  static calcular(
    prazoProposta: Date | null,
    agora: Date,
    diasLimiar: number = DIAS_ATE_PRAZO_CRITICO_PADRAO,
  ): PrazoCritico {
    if (prazoProposta === null) return new PrazoCritico(false);
    const diasAtePrazo = (prazoProposta.getTime() - agora.getTime()) / 86_400_000;
    return new PrazoCritico(diasAtePrazo >= 0 && diasAtePrazo <= diasLimiar);
  }

  /** Reconstitui a partir do booleano persistido — sem recalcular (o instante do cálculo já passou). */
  static reconstituir(critico: boolean): PrazoCritico {
    return new PrazoCritico(critico);
  }

  equals(other: PrazoCritico): boolean {
    return this.critico === other.critico;
  }
}
