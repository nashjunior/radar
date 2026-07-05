import { AcessoNegadoError } from '@radar/kernel';
import type { EditalId, PerfilId, TenantId, ClienteFinalId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

export interface GetTriagemInput {
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  editalId: EditalId;
  perfilId: PerfilId;
}

/** Use case abortável (AbortSignal) — a navegação cancela a chamada em andamento. */
export class GetTriagemUseCase {
  constructor(private readonly gateway: TriagemGateway) {}

  async executar(input: GetTriagemInput, signal: AbortSignal): Promise<TriagemViewModel> {
    const triagem = await this.gateway.buscarPorEdital(
      { tenantId: input.tenantId, editalId: input.editalId, perfilId: input.perfilId },
      signal,
    );

    if (!triagem) {
      throw new AcessoNegadoError();
    }

    return triagem;
  }
}
