import type { EditalId, PerfilId } from '@radar/kernel';
import type { ExtracaoEdital } from '../domain/extracao-edital.js';
import type { Triagem } from '../domain/triagem.js';

// ---------------------------------------------------------------------------
// Ports de saída (implementados na infra/) — nomenclatura por papel (A10 §8).
// Escopo desta issue (RAD-42, read path): os dois repositórios que o
// ConsultarTriagemUseCase injeta. Os demais ports (PerfilGateway, LlmGateway,
// EventPublisher, ObjectStorage) entram com o write path do core em RAD-30.
// ---------------------------------------------------------------------------

/**
 * Extração é catálogo GLOBAL e cacheável (P-45): a chave é só o `editalId`, sem `tenantId`.
 * A autorização por objeto acontece via a `Triagem` (escopada), nunca aqui.
 */
export interface ExtracaoRepository {
  porEdital(id: EditalId, signal: AbortSignal): Promise<ExtracaoEdital | null>;
  salvar(extracao: ExtracaoEdital, signal: AbortSignal): Promise<void>;
}

/** Triagem é escopada ao tenant/cliente (P-49). */
export interface TriagemRepository {
  salvar(triagem: Triagem, signal: AbortSignal): Promise<void>;
  porEditalEPerfil(
    editalId: EditalId,
    perfilId: PerfilId,
    signal: AbortSignal,
  ): Promise<Triagem | null>;
}
