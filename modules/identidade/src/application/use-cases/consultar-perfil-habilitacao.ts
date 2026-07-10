import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { perfilParaDTO } from '../dtos.js';
import type { PerfilDTO } from '../dtos.js';
import type { PerfilRepository } from '../ports.js';

export interface ConsultarPerfilInput {
  readonly tenantId: TenantId;
  readonly clienteFinalId: ClienteFinalId;
}

/**
 * Leitura do Perfil de Habilitação (docs/14 §6, P-101).
 * Autorização por objeto (P-51/AB1): objeto encontrado com posse divergente
 * é acesso negado; ausência real segue indistinguível de não encontrado.
 */
export class ConsultarPerfilHabilitacaoUseCase {
  constructor(private readonly perfis: PerfilRepository) {}

  async executar(input: ConsultarPerfilInput, signal: AbortSignal): Promise<PerfilDTO | null> {
    const perfil = await this.perfis.porClienteFinal(input.tenantId, input.clienteFinalId, signal);
    if (!perfil) return null;
    // Defense-in-depth: verify object ownership (P-51/AB1).
    if (perfil.tenantId !== input.tenantId || perfil.clienteFinalId !== input.clienteFinalId) {
      throw new AcessoNegadoError();
    }
    return perfilParaDTO(perfil);
  }
}
