/**
 * Decisão de Produto P-81 (docs/11 §4): um alerta é CRÍTICO se o prazo final estiver
 * em até `diasAtePrazo` dias corridos OU se a aderência for ≥ `aderencia`. Os limiares
 * são config injetada no composition root (infra/config/politica-anti-fadiga.ts) — o
 * default abaixo é o valor de P-81, não uma constante de negócio implícita no código.
 */
export interface LimiaresCriticidade {
  diasAtePrazo: number;
  aderencia: number;
}

export const LIMIARES_CRITICIDADE_PADRAO: LimiaresCriticidade = {
  diasAtePrazo: 3,
  aderencia: 0.8,
};

/**
 * Criticidade calculada a partir do prazo da proposta OU da aderência do alerta (P-81, docs/11 §4).
 */
export class Criticidade {
  private constructor(readonly urgente: boolean) {}

  static deAlerta(
    alerta: { diasAtePrazo: number; aderencia: number },
    limiares: LimiaresCriticidade = LIMIARES_CRITICIDADE_PADRAO,
  ): Criticidade {
    const prazoCurto = alerta.diasAtePrazo <= limiares.diasAtePrazo;
    const altaAderencia = alerta.aderencia >= limiares.aderencia;
    return new Criticidade(prazoCurto || altaAderencia);
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
