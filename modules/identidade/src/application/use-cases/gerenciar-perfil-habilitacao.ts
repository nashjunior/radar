import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import { PerfilAtualizado } from '../events.js';
import { perfilParaDTO } from '../dtos.js';
import type { PerfilDTO } from '../dtos.js';
import type { EventPublisher, PerfilIdProvider, PerfilRepository } from '../ports.js';

export interface GerenciarPerfilInput {
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  habJuridica: readonly string[];
  habFiscal: readonly string[];
  habTecnica: readonly string[];
  habEconomica: readonly string[];
}

/**
 * Upsert do Perfil de Habilitação (docs/14 §6).
 * Autorização por objeto (P-51): verifica tenantId + clienteFinalId no perfil existente.
 * Cria perfil novo quando inexistente; atualiza as quatro dimensões quando existe.
 * Emite `perfil.atualizado` para que outros contextos (Triagem) recarreguem o perfil.
 */
export class GerenciarPerfilHabilitacaoUseCase {
  constructor(
    private readonly perfis: PerfilRepository,
    private readonly idProvider: PerfilIdProvider,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: GerenciarPerfilInput, signal: AbortSignal): Promise<PerfilDTO> {
    const existente = await this.perfis.porClienteFinal(input.tenantId, input.clienteFinalId, signal);

    let perfil: PerfilHabilitacao;

    if (existente) {
      // Autorização por objeto: verifica posse antes de qualquer mutação (P-51)
      if (existente.tenantId !== input.tenantId || existente.clienteFinalId !== input.clienteFinalId) {
        throw new AcessoNegadoError();
      }
      perfil = existente.atualizarDimensoes({
        habJuridica: input.habJuridica,
        habFiscal: input.habFiscal,
        habTecnica: input.habTecnica,
        habEconomica: input.habEconomica,
      });
    } else {
      perfil = PerfilHabilitacao.criar({
        id: this.idProvider.gerar(),
        tenantId: input.tenantId,
        clienteFinalId: input.clienteFinalId,
        habJuridica: input.habJuridica,
        habFiscal: input.habFiscal,
        habTecnica: input.habTecnica,
        habEconomica: input.habEconomica,
      });
    }

    await this.perfis.salvar(perfil, signal);
    await this.eventos.publicar(
      new PerfilAtualizado({ tenantId: perfil.tenantId, clienteFinalId: perfil.clienteFinalId, perfilId: perfil.id }),
      signal,
    );

    return perfilParaDTO(perfil);
  }
}
