import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';

export interface FeedbackTriagemInput {
  tenantId: TenantId;
  editalId: EditalId;
  perfilId: PerfilId;
}

export class FeedbackTriagemUseCase {
  constructor(private readonly gateway: TriagemGateway) {}

  async aceitar(input: FeedbackTriagemInput, signal: AbortSignal): Promise<void> {
    return this.gateway.aceitar(input, signal);
  }

  async contestar(input: FeedbackTriagemInput & { motivo?: string }, signal: AbortSignal): Promise<void> {
    return this.gateway.contestar(input, signal);
  }

  async registrarDecisao(input: FeedbackTriagemInput & { go: boolean }, signal: AbortSignal): Promise<void> {
    return this.gateway.registrarDecisao(input, signal);
  }
}
