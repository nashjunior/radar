import type { DefinirCriterioInput, CriterioResposta, MatchingApiGateway } from '@/application/ports';

export class DefinirCriterioUseCase {
  constructor(private readonly matching: MatchingApiGateway) {}

  async executar(input: DefinirCriterioInput, signal: AbortSignal): Promise<CriterioResposta> {
    return this.matching.definirCriterio(input, signal);
  }
}
