import { AcessoNegadoError, DomainError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { TriagemAceita, TriagemContestada, TriagemDecisao } from '../events.js';
import type { EventPublisher, TriagemRepository } from '../ports.js';

/** Contexto comum de autorização por objeto (P-51). */
interface BaseInput {
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
  tenantId: TenantId;
}

export type RegistrarFeedbackTriagemInput =
  | (BaseInput & { tipo: 'aceita' })
  | (BaseInput & { tipo: 'contestada'; motivo: string | null })
  | (BaseInput & { tipo: 'decisao'; go: boolean });

/**
 * Registra feedback do usuário sobre uma triagem (aceita, contestada, decisão go/no-go).
 *
 * Autorização POR OBJETO (P-51): lê a triagem existente e valida tenantId + clienteFinalId
 * antes de emitir qualquer evento — nunca vaza dados cross-tenant.
 *
 * O reprocessamento após contestação é um passo EXPLÍCITO via POST /solicitar (RAD-80)
 * — não é desencadeado automaticamente aqui para não forçar custo de LLM sem consentimento
 * explícito do usuário.
 */
export class RegistrarFeedbackTriagemUseCase {
  constructor(
    private readonly triagens: TriagemRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: RegistrarFeedbackTriagemInput, signal: AbortSignal): Promise<void> {
    const triagem = await this.triagens.porEditalEPerfil(
      input.tenantId, input.clienteFinalId, input.editalId, input.perfilId, signal,
    );

    if (!triagem) throw new TriagemNaoEncontradaError(input.editalId, input.perfilId);
    if (triagem.tenantId !== input.tenantId || triagem.clienteFinalId !== input.clienteFinalId) {
      throw new AcessoNegadoError();
    }

    const base = {
      tenantId: input.tenantId,
      clienteFinalId: input.clienteFinalId,
      editalId: input.editalId,
      perfilId: input.perfilId,
    };

    switch (input.tipo) {
      case 'aceita':
        await this.eventos.publicar(new TriagemAceita(base), signal);
        break;
      case 'contestada':
        await this.eventos.publicar(new TriagemContestada({ ...base, motivo: input.motivo }), signal);
        break;
      case 'decisao':
        await this.eventos.publicar(new TriagemDecisao({ ...base, go: input.go }), signal);
        break;
    }
  }
}

/** Thrown when no triagem record exists for the given edital + perfil pair. Maps to HTTP 404. */
export class TriagemNaoEncontradaError extends DomainError {
  readonly code = 'TRIAGEM_NAO_ENCONTRADA' as const;
  constructor(editalId: EditalId, perfilId: PerfilId) {
    super(`Triagem não encontrada: editalId=${editalId}, perfilId=${perfilId}`);
  }
}
