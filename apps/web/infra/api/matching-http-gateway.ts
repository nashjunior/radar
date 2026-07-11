import type { DefinirCriterioInput, CriterioResposta, MatchingApiGateway } from '@/application/ports';
import { SessaoExpiradaError, AcessoNegadoError } from '@/application/errors';

export class MatchingHttpGateway implements MatchingApiGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async definirCriterio(input: DefinirCriterioInput, signal: AbortSignal): Promise<CriterioResposta> {
    const res = await fetch(`${this.baseUrl}/api/matching/criterios`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(input),
      signal,
    });

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (!res.ok) throw new Error(`[MatchingHttpGateway] HTTP ${res.status}`);

    return (await res.json()) as CriterioResposta;
  }

  async registrarFeedback(input: { alertaId: string; relevante: boolean }, signal: AbortSignal): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/matching/alertas/${encodeURIComponent(input.alertaId)}/feedback`,
      {
        method: 'PATCH',
        headers: await this.headers(),
        body: JSON.stringify({ relevante: input.relevante }),
        signal,
      },
    );

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 403) throw new AcessoNegadoError();
    if (res.status === 404) throw new Error('Alerta não encontrado.');
    if (!res.ok) throw new Error(`[MatchingHttpGateway] HTTP ${res.status}`);
  }
}
