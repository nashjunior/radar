import type { AssinaturaGateway } from '@/application/ports.js';
import type { AssinaturaViewModel } from '@/domain/assinatura.js';
import { fetchApi } from './http-client.js';

export class AssinaturaHttpGateway implements AssinaturaGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async obter(signal: AbortSignal): Promise<AssinaturaViewModel> {
    const res = await fetchApi(`${this.baseUrl}/api/me/assinatura`, this.getToken, { signal });
    return (await res!.json()) as AssinaturaViewModel;
  }

  async iniciarCheckout(input: { planoCodigo: string }, signal: AbortSignal): Promise<{ urlCheckout: string }> {
    const res = await fetchApi(`${this.baseUrl}/api/checkout/iniciar`, this.getToken, {
      method: 'POST',
      json: true,
      body: JSON.stringify({ planoCodigo: input.planoCodigo }),
      signal,
    });
    return (await res!.json()) as { urlCheckout: string };
  }
}
