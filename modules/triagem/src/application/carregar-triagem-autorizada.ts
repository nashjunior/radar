import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { Triagem } from '../domain/triagem.js';
import type { TriagemRepository } from './ports.js';

/** Chave de posse compartilhada entre o read path e o registro de feedback (P-51). */
export interface TriagemAutorizadaInput {
  tenantId: TenantId;
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
}

/**
 * Busca + autorização POR OBJETO (P-51) compartilhada entre `ConsultarTriagemUseCase` e
 * `RegistrarFeedbackTriagemUseCase` (RAD-186): valida `tenantId`/`clienteFinalId` ANTES de expor
 * qualquer estado — nunca vaza triagem de outro tenant. `onNotFound` decide o desfecho de
 * "não encontrada" (cada use case mantém o próprio: `null` vs. erro).
 */
export async function carregarTriagemAutorizada<T>(
  triagens: TriagemRepository,
  input: TriagemAutorizadaInput,
  onNotFound: () => T,
  signal: AbortSignal,
): Promise<Triagem | T> {
  const triagem = await triagens.porEditalEPerfil(
    input.tenantId,
    input.clienteFinalId,
    input.editalId,
    input.perfilId,
    signal,
  );
  if (triagem === null) return onNotFound();

  if (triagem.tenantId !== input.tenantId || triagem.clienteFinalId !== input.clienteFinalId) {
    throw new AcessoNegadoError();
  }
  return triagem;
}
