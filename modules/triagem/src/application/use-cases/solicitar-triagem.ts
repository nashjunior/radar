import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { Triagem } from '../../domain/triagem.js';
import { TriagemSolicitada } from '../events.js';
import type { EventPublisher, PerfilGateway, TriagemRepository } from '../ports.js';

export interface SolicitarTriagemInput {
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
  /** Resolvido na borda (BFF/composition root); MVP single-tenant `global` (P-25). Branded fora da application (ids.ts). */
  tenantId: TenantId;
}

/**
 * Trigger: Usuário (API). Faz a 1ª verificação de autorização (defesa em profundidade), persiste o
 * estado `processando` (para que o read path saiba distinguir de `nunca_solicitada` — RAD-79) e
 * publica o comando na fila — a triagem em si é assíncrona (custo/latência, A03 §§1,3; A00 princípio 6).
 * NÃO chama o LLM nem toca a extração.
 */
export class SolicitarTriagemUseCase {
  constructor(
    private readonly perfis: PerfilGateway,
    private readonly triagens: TriagemRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: SolicitarTriagemInput, signal: AbortSignal): Promise<void> {
    // Autorização POR OBJETO já na borda (P-51 / AB1): não enfileira pedido de perfil alheio.
    const perfil = await this.perfis.porId(input.perfilId, signal);
    if (perfil === null || perfil.clienteFinalId !== input.clienteFinalId) {
      throw new AcessoNegadoError();
    }

    // Persiste `processando` se não há triagem existente — não sobrescreve `concluida`/`incompleta`
    // para que um segundo clique de um usuário não apague o resultado anterior (idempotente).
    const existente = await this.triagens.porEditalEPerfil(
      input.tenantId, input.clienteFinalId, input.editalId, input.perfilId, signal,
    );
    if (existente === null) {
      await this.triagens.salvar(
        Triagem.pendente(input.editalId, input.perfilId, input.tenantId, perfil.clienteFinalId),
        signal,
      );
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
