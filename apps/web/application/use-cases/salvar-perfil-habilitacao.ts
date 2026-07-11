import type { PerfilHabilitacaoGateway, PerfilHabilitacaoDTO } from '@/application/ports.js';

export class SalvarPerfilHabilitacaoUseCase {
  constructor(private readonly gateway: PerfilHabilitacaoGateway) {}

  async executar(input: PerfilHabilitacaoDTO, signal: AbortSignal): Promise<void> {
    return this.gateway.salvar(input, signal);
  }
}
