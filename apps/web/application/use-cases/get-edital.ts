import type { EditalId } from '@radar/kernel';
import type { EditalGateway } from '@/application/ports';
import type { EditalDetalhe } from '@/domain/edital-detalhe';

export interface GetEditalInput {
  editalId: EditalId;
}

export class GetEditalUseCase {
  constructor(private readonly editalGateway: EditalGateway) {}

  async executar(input: GetEditalInput, signal: AbortSignal): Promise<EditalDetalhe | null> {
    return this.editalGateway.buscarDetalhes(input.editalId, signal);
  }
}
