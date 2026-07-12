import type { OrganizacaoGateway, OrganizacaoDTO } from '@/application/ports.js';
import { CnpjInvalidoError, OrganizacaoJaExisteError, SessaoExpiradaError } from '@/application/errors.js';

export class OrganizacaoHttpGateway implements OrganizacaoGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async provisionar(
    input: { cnpj: string; razaoSocial: string },
    signal: AbortSignal,
  ): Promise<OrganizacaoDTO> {
    const token = await this.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/api/organizacoes`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();

    if (!res.ok) {
      let body: { code?: string } = {};
      try { body = (await res.json()) as { code?: string }; } catch { /* ignore */ }
      if (body.code === 'CNPJ_INVALIDO') throw new CnpjInvalidoError();
      if (body.code === 'ORGANIZACAO_JA_EXISTE') throw new OrganizacaoJaExisteError();
      throw new Error(`[OrganizacaoHttpGateway] HTTP ${res.status}`);
    }

    return (await res.json()) as OrganizacaoDTO;
  }
}
