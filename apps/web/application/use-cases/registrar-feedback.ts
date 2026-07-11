import type { MatchingApiGateway } from '@/application/ports';

export class RegistrarFeedbackUseCase {
  constructor(private readonly matching: MatchingApiGateway) {}

  async executar(input: { alertaId: string; relevante: boolean }, signal: AbortSignal): Promise<void> {
    return this.matching.registrarFeedback(input, signal);
  }
}
