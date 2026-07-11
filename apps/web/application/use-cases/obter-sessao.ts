import type { SessaoGateway } from '@/application/ports';
import type { SessaoUsuario } from '@/domain/sessao';

export class ObterSessaoUseCase {
  constructor(private readonly sessao: SessaoGateway) {}

  async executar(signal: AbortSignal): Promise<SessaoUsuario> {
    return this.sessao.obter(signal);
  }
}
