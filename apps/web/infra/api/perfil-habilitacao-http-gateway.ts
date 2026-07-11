import type { PerfilHabilitacaoGateway, PerfilHabilitacaoDTO } from '@/application/ports';
import { SessaoExpiradaError, AcessoNegadoError } from '@/application/errors';

/** Shape retornado por GET/PUT /api/identidade/perfil no BFF. */
interface PerfilApiDTO {
  id: string;
  clienteFinalId: string;
  habJuridica: string[];
  habFiscal: string[];
  habTecnica: string[];
  habEconomica: string[];
}

function apiParaFront(dto: PerfilApiDTO): PerfilHabilitacaoDTO {
  return {
    habJuridica: dto.habJuridica.join('\n'),
    habFiscal: dto.habFiscal.join('\n'),
    habTecnica: dto.habTecnica.join('\n'),
    habEconomica: dto.habEconomica.join('\n'),
  };
}

function frontParaApi(dto: PerfilHabilitacaoDTO): Pick<PerfilApiDTO, 'habJuridica' | 'habFiscal' | 'habTecnica' | 'habEconomica'> {
  const toArray = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    habJuridica: toArray(dto.habJuridica),
    habFiscal: toArray(dto.habFiscal),
    habTecnica: toArray(dto.habTecnica),
    habEconomica: toArray(dto.habEconomica),
  };
}

export class PerfilHabilitacaoHttpGateway implements PerfilHabilitacaoGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  async consultar(signal: AbortSignal): Promise<PerfilHabilitacaoDTO | null> {
    const res = await fetch(`${this.baseUrl}/api/identidade/perfil`, {
      method: 'GET',
      headers: await this.headers(),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`[PerfilHabilitacaoHttpGateway] HTTP ${res.status}`);

    return apiParaFront((await res.json()) as PerfilApiDTO);
  }

  async salvar(input: PerfilHabilitacaoDTO, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/identidade/perfil`, {
      method: 'PUT',
      headers: await this.headers(),
      body: JSON.stringify(frontParaApi(input)),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (!res.ok) throw new Error(`[PerfilHabilitacaoHttpGateway] HTTP ${res.status}`);
  }
}
