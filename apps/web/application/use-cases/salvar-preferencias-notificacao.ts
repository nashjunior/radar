import type { SalvarPreferenciasInput, PreferenciasNotificacaoDTO, NotificacaoGateway } from '@/application/ports';

export class SalvarPreferenciasNotificacaoUseCase {
  constructor(private readonly notificacao: NotificacaoGateway) {}

  async executar(input: SalvarPreferenciasInput, signal: AbortSignal): Promise<PreferenciasNotificacaoDTO> {
    return this.notificacao.salvarPreferencias(input, signal);
  }
}
