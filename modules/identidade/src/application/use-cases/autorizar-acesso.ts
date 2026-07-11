import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId } from '@radar/kernel';
import { podeExecutar } from '../../domain/matriz-permissoes.js';
import type { Acao, Recurso } from '../../domain/matriz-permissoes.js';
import type { ContextoAutorizacaoDTO } from '../dtos.js';

export interface AutorizarAcessoInput {
  readonly contexto: ContextoAutorizacaoDTO;
  readonly recurso: Recurso;
  readonly acao: Acao;
  readonly clienteFinalId?: ClienteFinalId;
}

/**
 * Checagem RBAC "este papel pode tentar esta ação" (docs/05 §4, P-52) — chamada em
 * toda requisição. Cumulativa com a autorização por objeto (P-51/AB1), que continua
 * dentro de cada use case do contexto dono; nenhum controle substitui o outro.
 * Sem I/O: o contexto já chega resolvido pelo chamador (ResolverContextoAutorizacaoUseCase).
 */
export class AutorizarAcessoUseCase {
  async executar(input: AutorizarAcessoInput, signal: AbortSignal): Promise<void> {
    if (!podeExecutar(input.contexto.papel, input.recurso, input.acao)) {
      throw new AcessoNegadoError();
    }

    // Escopo de clienteFinalId: ADMIN_CONSULTORIA tem o tenant inteiro; os demais
    // papéis só o(s) clienteFinalId(s) explicitamente atribuídos (docs/05 §4).
    if (
      input.clienteFinalId !== undefined &&
      input.contexto.papel !== 'ADMIN_CONSULTORIA' &&
      !input.contexto.clienteFinalIds.includes(input.clienteFinalId)
    ) {
      throw new AcessoNegadoError();
    }
  }
}
