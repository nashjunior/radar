import { DomainError } from '@radar/kernel';
import { CotaMensal } from './cota-mensal.js';

class PlanoComercialInvalidoError extends DomainError {
  readonly code = 'PLANO_COMERCIAL_INVALIDO' as const;
  constructor(motivo: string) {
    super(`plano comercial inválido: ${motivo}`);
  }
}

export interface CriarPlanoComercialProps {
  codigo: string;
  cotaTriagensMes: number;
  precoCentavos: number;
}

/**
 * VO imutável: nível de contratação do SaaS (docs/06 — "Plano (comercial)"). Nomeado
 * `PlanoComercial`, não `Plano`, porque "Plano" já é o PCA (Plano de Contratações
 * Anual) no domínio de licitações — mesmo termo, dois sentidos, contextos distintos
 * (docs/13 §3, nota de linguagem ubíqua).
 */
export class PlanoComercial {
  private constructor(
    readonly codigo: string,
    readonly cota: CotaMensal,
    readonly precoCentavos: number,
  ) {}

  static criar(props: CriarPlanoComercialProps): PlanoComercial {
    if (!props.codigo.trim()) throw new PlanoComercialInvalidoError('codigo vazio');
    if (!Number.isInteger(props.precoCentavos) || props.precoCentavos < 0) {
      throw new PlanoComercialInvalidoError(`precoCentavos inválido: ${props.precoCentavos}`);
    }
    return new PlanoComercial(props.codigo, CotaMensal.criar(props.cotaTriagensMes), props.precoCentavos);
  }

  equals(other: PlanoComercial): boolean {
    return (
      this.codigo === other.codigo &&
      this.cota.equals(other.cota) &&
      this.precoCentavos === other.precoCentavos
    );
  }
}
