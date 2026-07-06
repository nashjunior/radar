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
 * Autorização por objeto (P-51/AB1): mismatch de posse → null,
 * indistinguível de não encontrado (A17 §5.3).
 */
export class ConsultarPerfilHabilitacaoUseCase {
  constructor(private readonly perfis: PerfilRepository) {}

  async executar(input: ConsultarPerfilInput, signal: AbortSignal): Promise<PerfilDTO | null> {
    const perfil = await this.perfis.porClienteFinal(input.tenantId, input.clienteFinalId, signal);
    if (!perfil) return null;
    // Defense-in-depth: verify object ownership (P-51/AB1) — mismatch = null (A17 §5.3)
    if (perfil.tenantId !== input.tenantId || perfil.clienteFinalId !== input.clienteFinalId) {
      return null;
    }
    return perfilParaDTO(perfil);
  }
}
