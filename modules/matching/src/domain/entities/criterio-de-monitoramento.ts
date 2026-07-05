import type { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { CriterioInvalidoError } from '../errors/index.js';
import type { FaixaValor } from '../value-objects/faixa-valor.js';
import type { PalavrasChave } from '../value-objects/palavras-chave.js';

export interface CriarCriterioParams {
  id: CriterioId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  ramoCnae?: string | undefined;
  regiaoUf?: string | undefined;
  faixaValor?: FaixaValor | undefined;
  palavrasChave?: PalavrasChave | undefined;
}

export interface ReconstituirCriterioParams extends CriarCriterioParams {
  ativo: boolean;
}

/**
 * Agregado raiz do bounded context Monitoramento & Matching (docs/13 §3).
 * tenantId presente desde o dia 1 (A01 §6), mesmo no MVP single-tenant.
 */
export class CriterioDeMonitoramento {
  private constructor(
    readonly id: CriterioId,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId,
    readonly ramoCnae: string | null,
    readonly regiaoUf: string | null,
    readonly faixaValor: FaixaValor | null,
    readonly palavrasChave: PalavrasChave | null,
    readonly ativo: boolean,
  ) {}

  static criar(params: CriarCriterioParams): CriterioDeMonitoramento {
    if (!params.ramoCnae && !params.palavrasChave)
      throw new CriterioInvalidoError('critério requer ao menos ramo/CNAE ou palavras-chave');
    return new CriterioDeMonitoramento(
      params.id,
      params.tenantId,
      params.clienteFinalId,
      params.ramoCnae ?? null,
      params.regiaoUf ?? null,
      params.faixaValor ?? null,
      params.palavrasChave ?? null,
      true,
    );
  }

  /** Reconstitui a entidade a partir da persistência — sem validação de invariantes de criação. */
  static reconstituir(params: ReconstituirCriterioParams): CriterioDeMonitoramento {
    return new CriterioDeMonitoramento(
      params.id,
      params.tenantId,
      params.clienteFinalId,
      params.ramoCnae ?? null,
      params.regiaoUf ?? null,
      params.faixaValor ?? null,
      params.palavrasChave ?? null,
      params.ativo,
    );
  }
}
