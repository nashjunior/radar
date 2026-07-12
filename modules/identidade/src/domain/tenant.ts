import type { TenantId } from '@radar/kernel';
import type { Cnpj } from './value-objects/cnpj.js';

export interface CriarTenantProps {
  id: TenantId;
  cnpj: Cnpj;
  razaoSocial: string;
}

/**
 * Agregado raiz do contexto Identidade & Organização (docs/14 §6, docs/13 §3).
 * Nasce no `ProvisionarOrganizacaoUseCase` — unicidade 1 CNPJ = 1 tenant é
 * imposta pela infra (constraint UNIQUE), não por esta entidade (P-109 L3).
 */
export class Tenant {
  private constructor(
    readonly id: TenantId,
    readonly cnpj: Cnpj,
    readonly razaoSocial: string,
  ) {}

  static criar(props: CriarTenantProps): Tenant {
    return new Tenant(props.id, props.cnpj, props.razaoSocial.trim());
  }
}
