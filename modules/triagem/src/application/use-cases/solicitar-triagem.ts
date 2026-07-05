import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { TriagemSolicitada } from '../events.js';
import type { EventPublisher, PerfilGateway } from '../ports.js';

export interface SolicitarTriagemInput {
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
  /** Resolvido na borda (BFF/composition root); MVP single-tenant `global` (P-25). Branded fora da application (ids.ts). */
  tenantId: TenantId;
}

/**
 * Trigger: Usuário (API). Faz a 1ª verificação de autorização (defesa em profundidade) e publica o
 * comando na fila — a triagem em si é assíncrona (custo/latência, A03 §§1,3; A00 princípio 6).
 * NÃO chama o LLM nem toca a extração: só valida o escopo e enfileira.
 */
export class SolicitarTriagemUseCase {
  constructor(
    private readonly perfis: PerfilGateway,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: SolicitarTriagemInput, signal: AbortSignal): Promise<void> {
    // Autorização POR OBJETO já na borda (P-51 / AB1): não enfileira pedido de perfil alheio. Perfil
    // ausente e perfil de outro cliente colapsam no MESMO erro — não vaza existência (A17 §5.3).
    const perfil = await this.perfis.porId(input.perfilId, signal);
    if (perfil === null || perfil.clienteFinalId !== input.clienteFinalId) {
      throw new AcessoNegadoError();
    }

    await this.eventos.publicar(
      new TriagemSolicitada({
        tenantId: input.tenantId,
        usuarioId: input.clienteFinalId,
        editalId: input.editalId,
        perfilId: input.perfilId,
      }),
      signal,
    );
  }
}
