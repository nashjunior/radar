import type { ClienteFinalId, TenantId } from '@radar/kernel';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';
import type { AtribuicaoPapel, UsuarioId } from '../domain/atribuicao-papel.js';
import type { Papel } from '../domain/papel.js';

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

/** Contexto de autorização resolvido (docs/14 §6) — atravessa a borda para AutorizarAcessoUseCase. */
export interface ContextoAutorizacaoDTO {
  readonly usuarioId: UsuarioId;
  readonly tenantId: TenantId;
  readonly papel: Papel;
  readonly clienteFinalIds: readonly ClienteFinalId[];
}

export function contextoAutorizacaoParaDTO(a: AtribuicaoPapel): ContextoAutorizacaoDTO {
  return {
    usuarioId: a.usuarioId,
    tenantId: a.tenantId,
    papel: a.papel,
    clienteFinalIds: [...a.clienteFinalIds],
  };
}
