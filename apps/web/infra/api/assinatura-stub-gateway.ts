import type { AssinaturaGateway } from '@/application/ports.js';
import type { AssinaturaViewModel } from '@/domain/assinatura.js';

const STUB_PADRAO: AssinaturaViewModel = {
  plano: 'Starter',
  status: 'trial',
  cota: 10,
  usado: 3,
  restante: 7,
  cicloFim: '2026-08-01',
  trialTerminaEm: '2026-07-25',
};

export class AssinaturaStubGateway implements AssinaturaGateway {
  constructor(private readonly stub: AssinaturaViewModel = STUB_PADRAO) {}

  async obter(_signal: AbortSignal): Promise<AssinaturaViewModel> {
    return this.stub;
  }

  async iniciarCheckout(_signal: AbortSignal): Promise<{ urlCheckout: string }> {
    return { urlCheckout: 'https://checkout.example.com/mock-session' };
  }
}
