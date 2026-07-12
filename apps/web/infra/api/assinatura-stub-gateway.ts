import type { AssinaturaGateway } from '@/application/ports.js';
import type { AssinaturaViewModel } from '@/domain/assinatura.js';

const STUB_PADRAO: AssinaturaViewModel = {
  estado: 'trial',
  plano: { codigo: 'starter', cota: 10 },
  usoReservado: 3,
  usoConfirmado: 3,
  diasRestantes: 13,
};

export class AssinaturaStubGateway implements AssinaturaGateway {
  constructor(private readonly stub: AssinaturaViewModel = STUB_PADRAO) {}

  async obter(_signal: AbortSignal): Promise<AssinaturaViewModel> {
    return this.stub;
  }

  async iniciarCheckout(_input: { planoCodigo: string }, _signal: AbortSignal): Promise<{ urlCheckout: string }> {
    return { urlCheckout: 'https://checkout.example.com/mock-session' };
  }
}
