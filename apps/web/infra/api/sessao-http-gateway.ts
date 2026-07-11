/** Gateway HTTP para GET /api/me (P-52 · RAD-213). */
import type { SessaoGateway } from '@/application/ports';
import type { SessaoUsuario } from '@/domain/sessao';
import { SessaoExpiradaError, AcessoNegadoError } from '@/application/errors';

interface MeDTO {
  usuarioId: string;
  tenantId: string;
  papel: string;
  clienteFinalIds: string[];
}

export class SessaoHttpGateway implements SessaoGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async obter(signal: AbortSignal): Promise<SessaoUsuario> {
    const res = await fetch(`${this.baseUrl}/api/me`, {
      headers: await this.headers(),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (!res.ok) throw new Error(`[SessaoHttpGateway] HTTP ${res.status}`);

    const dto = (await res.json()) as MeDTO;
    return {
      usuarioId: dto.usuarioId,
      tenantId: dto.tenantId,
      papel: dto.papel as SessaoUsuario['papel'],
      clienteFinalIds: dto.clienteFinalIds,
    };
  }
}
