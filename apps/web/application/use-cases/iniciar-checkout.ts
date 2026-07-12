import type { AssinaturaGateway } from '@/application/ports.js';

export class IniciarCheckoutUseCase {
  constructor(private readonly gateway: AssinaturaGateway) {}

  async executar(input: { planoCodigo: string }, signal: AbortSignal): Promise<{ urlCheckout: string }> {
    return this.gateway.iniciarCheckout(input, signal);
  }
}
