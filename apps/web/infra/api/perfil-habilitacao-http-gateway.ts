import type { PerfilHabilitacaoGateway, PerfilHabilitacaoDTO } from '@/application/ports';
import { fetchApi } from './http-client';

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

  async consultar(signal: AbortSignal): Promise<PerfilHabilitacaoDTO | null> {
    const res = await fetchApi(`${this.baseUrl}/api/identidade/perfil`, this.getToken, {
      signal,
      on404: 'null',
    });
    if (!res) return null;
    return apiParaFront((await res.json()) as PerfilApiDTO);
  }

  async salvar(input: PerfilHabilitacaoDTO, signal: AbortSignal): Promise<void> {
    await fetchApi(`${this.baseUrl}/api/identidade/perfil`, this.getToken, {
      method: 'PUT',
      json: true,
      body: JSON.stringify(frontParaApi(input)),
      signal,
    });
  }
}
