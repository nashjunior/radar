import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports.js';

export interface SolicitarTriagemInput {
  tenantId: TenantId;
  editalId: EditalId;
  perfilId: PerfilId;
}

/** Solicita análise de triagem por IA. Lança CotaExcedidaError (via http-client) se HTTP 402. */
export class SolicitarTriagemUseCase {
  constructor(private readonly gateway: TriagemGateway) {}

  async executar(
    input: SolicitarTriagemInput,
    signal: AbortSignal,
  ): Promise<{ editalId: EditalId; estado: 'processando' }> {
    return this.gateway.solicitar(input, signal);
  }
}
