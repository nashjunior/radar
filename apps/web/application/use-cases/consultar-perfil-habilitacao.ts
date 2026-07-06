import type { PerfilHabilitacaoGateway, PerfilHabilitacaoDTO } from '@/application/ports.js';

export type ConsultarPerfilHabilitacaoInput = Record<string, never>;

export class ConsultarPerfilHabilitacaoUseCase {
  constructor(private readonly gateway: PerfilHabilitacaoGateway) {}

  async executar(_input: ConsultarPerfilHabilitacaoInput, signal: AbortSignal): Promise<PerfilHabilitacaoDTO | null> {
    return this.gateway.consultar(signal);
  }
}
