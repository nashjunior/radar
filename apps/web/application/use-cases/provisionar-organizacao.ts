import type { OrganizacaoGateway, OrganizacaoDTO } from '@/application/ports.js';

export interface ProvisionarOrganizacaoInput {
  cnpj: string;
  razaoSocial: string;
}

export class ProvisionarOrganizacaoUseCase {
  constructor(private readonly gateway: OrganizacaoGateway) {}

  async executar(input: ProvisionarOrganizacaoInput, signal: AbortSignal): Promise<OrganizacaoDTO> {
    return this.gateway.provisionar({ cnpj: input.cnpj, razaoSocial: input.razaoSocial }, signal);
  }
}
