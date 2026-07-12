import type { NotificacaoGateway, SalvarPreferenciasInput, PreferenciasNotificacaoDTO } from '@/application/ports';
import { fetchApi } from './http-client';

export class NotificacaoHttpGateway implements NotificacaoGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async salvarPreferencias(input: SalvarPreferenciasInput, signal: AbortSignal): Promise<PreferenciasNotificacaoDTO> {
    const res = await fetchApi(
      `${this.baseUrl}/api/notificacao/preferencias`,
      this.getToken,
      { method: 'PUT', json: true, body: JSON.stringify(input), signal },
    );
    return (await res!.json()) as PreferenciasNotificacaoDTO;
  }
}
