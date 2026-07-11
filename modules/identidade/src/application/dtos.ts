import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';

export interface PerfilDTO {
  readonly id: string;
  readonly clienteFinalId: string;
  readonly habJuridica: readonly string[];
  readonly habFiscal: readonly string[];
  readonly habTecnica: readonly string[];
  readonly habEconomica: readonly string[];
}

export function perfilParaDTO(p: PerfilHabilitacao): PerfilDTO {
  return {
    id: p.id,
    clienteFinalId: p.clienteFinalId,
    habJuridica: [...p.habJuridica],
    habFiscal: [...p.habFiscal],
    habTecnica: [...p.habTecnica],
    habEconomica: [...p.habEconomica],
  };
}
