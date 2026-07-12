import type { OrganizacaoGateway, OrganizacaoDTO } from '@/application/ports.js';

export class OrganizacaoStubGateway implements OrganizacaoGateway {
  async provisionar(
    input: { cnpj: string; razaoSocial: string },
    _signal: AbortSignal,
  ): Promise<OrganizacaoDTO> {
    return {
      tenantId: 'tenant-dev-novo',
      cnpj: input.cnpj,
      razaoSocial: input.razaoSocial,
      papel: 'ADMIN_CONSULTORIA',
    };
  }
}
