import type { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import type { AderenciaMatching } from '../value-objects/aderencia-matching.js';

export interface CriarAlertaParams {
  id: AlertaId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  criterioId: CriterioId;
  editalId: EditalId;
  aderencia: AderenciaMatching;
}

export interface ReconstituirAlertaParams extends CriarAlertaParams {
  relevante: boolean | null;
}

/**
 * Agregado raiz do bounded context Monitoramento & Matching (docs/13 §3).
 * Gerado pelo CasarEditalComCriteriosUseCase quando a aderência supera o limiar.
 * relevante = null enquanto o usuário não registrar feedback.
 */
export class Alerta {
  private constructor(
    readonly id: AlertaId,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId,
    readonly criterioId: CriterioId,
    readonly editalId: EditalId,
    readonly aderencia: AderenciaMatching,
    readonly relevante: boolean | null,
  ) {}

  static criar(params: CriarAlertaParams): Alerta {
    return new Alerta(
      params.id,
      params.tenantId,
      params.clienteFinalId,
      params.criterioId,
      params.editalId,
      params.aderencia,
      null,
    );
  }

  /** Reconstitui a entidade a partir da persistência — preserva relevante sem validação. */
  static reconstituir(params: ReconstituirAlertaParams): Alerta {
    return new Alerta(
      params.id,
      params.tenantId,
      params.clienteFinalId,
      params.criterioId,
      params.editalId,
      params.aderencia,
      params.relevante,
    );
  }

  /** Retorna nova instância com o feedback registrado — não muta. */
  comFeedback(relevante: boolean): Alerta {
    return new Alerta(
      this.id,
      this.tenantId,
      this.clienteFinalId,
      this.criterioId,
      this.editalId,
      this.aderencia,
      relevante,
    );
  }
}
