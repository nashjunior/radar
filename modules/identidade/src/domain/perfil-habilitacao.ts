import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';

/**
 * Agregado raiz do contexto Identidade & Organização (docs/14 §6, docs/13 §3).
 * Este contexto persiste o perfil via PerfilRepository.
 * A Triagem consome uma visão de leitura via PerfilGateway (Cliente-Fornecedor, P-83).
 */

export interface CriarPerfilHabilitacaoProps {
  id: PerfilId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  habJuridica: readonly string[];
  habFiscal: readonly string[];
  habTecnica: readonly string[];
  habEconomica: readonly string[];
}

export interface AtualizarDimensoesProps {
  habJuridica?: readonly string[];
  habFiscal?: readonly string[];
  habTecnica?: readonly string[];
  habEconomica?: readonly string[];
}

export class PerfilHabilitacao {
  private constructor(
    readonly id: PerfilId,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId,
    readonly habJuridica: readonly string[],
    readonly habFiscal: readonly string[],
    readonly habTecnica: readonly string[],
    readonly habEconomica: readonly string[],
  ) {}

  static criar(props: CriarPerfilHabilitacaoProps): PerfilHabilitacao {
    return new PerfilHabilitacao(
      props.id,
      props.tenantId,
      props.clienteFinalId,
      [...props.habJuridica],
      [...props.habFiscal],
      [...props.habTecnica],
      [...props.habEconomica],
    );
  }

  atualizarDimensoes(campos: AtualizarDimensoesProps): PerfilHabilitacao {
    return new PerfilHabilitacao(
      this.id,
      this.tenantId,
      this.clienteFinalId,
      campos.habJuridica ?? this.habJuridica,
      campos.habFiscal ?? this.habFiscal,
      campos.habTecnica ?? this.habTecnica,
      campos.habEconomica ?? this.habEconomica,
    );
  }
}
