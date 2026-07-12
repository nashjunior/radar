import type { AssinaturaGateway } from '@/application/ports.js';
import type { AssinaturaViewModel } from '@/domain/assinatura.js';

export class ObterAssinaturaUseCase {
  constructor(private readonly gateway: AssinaturaGateway) {}

  async executar(signal: AbortSignal): Promise<AssinaturaViewModel> {
    return this.gateway.obter(signal);
  }
}
