import type { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import type { AderenciaMatching } from '../value-objects/aderencia-matching.js';
import type { PrazoCritico } from '../value-objects/prazo-critico.js';

export interface CriarAlertaParams {
  id: AlertaId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  criterioId: CriterioId;
  editalId: EditalId;
  aderencia: AderenciaMatching;
  prazoCritico: PrazoCritico;
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
    readonly prazoCritico: PrazoCritico,
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
      params.prazoCritico,
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
      params.prazoCritico,
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
      this.prazoCritico,
      relevante,
    );
  }

  /**
   * Aderência alta OU prazo crítico (P-81, A18 §5.1) — decide se o alerta é imediato
   * ou pode cair no digest. Regra de domínio do Matching: vive no agregado, não no worker.
   */
  get imediato(): boolean {
    return this.aderencia.ehAlta || this.prazoCritico.critico;
  }
}
