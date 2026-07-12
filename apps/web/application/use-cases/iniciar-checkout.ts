import type { AssinaturaGateway } from '@/application/ports.js';

export class IniciarCheckoutUseCase {
  constructor(private readonly gateway: AssinaturaGateway) {}

  async executar(signal: AbortSignal): Promise<{ urlCheckout: string }> {
    return this.gateway.iniciarCheckout(signal);
  }
}
