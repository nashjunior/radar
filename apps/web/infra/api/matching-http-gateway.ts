import type { DefinirCriterioInput, CriterioResposta, MatchingApiGateway } from '@/application/ports';
import { fetchApi } from './http-client';

export class MatchingHttpGateway implements MatchingApiGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async definirCriterio(input: DefinirCriterioInput, signal: AbortSignal): Promise<CriterioResposta> {
    const res = await fetchApi(
      `${this.baseUrl}/api/matching/criterios`,
      this.getToken,
      { method: 'POST', json: true, body: JSON.stringify(input), signal },
    );
    return (await res!.json()) as CriterioResposta;
  }

  async registrarFeedback(input: { alertaId: string; relevante: boolean }, signal: AbortSignal): Promise<void> {
    await fetchApi(
      `${this.baseUrl}/api/matching/alertas/${encodeURIComponent(input.alertaId)}/feedback`,
      this.getToken,
      { method: 'PATCH', json: true, body: JSON.stringify({ relevante: input.relevante }), signal },
    );
  }
}
