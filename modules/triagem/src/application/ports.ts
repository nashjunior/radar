import type { EditalId, PerfilId } from '@radar/kernel';
import type { ExtracaoEdital } from '../domain/extracao-edital.js';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';
import type { Triagem } from '../domain/triagem.js';
import type { EntradaExtracaoDTO } from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Ports de saída (implementados na infra/) — nomenclatura por papel (A10 §8).
// Adapter = <Tecnologia><Port> (P-74); a tecnologia só aparece na infra.
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

/**
 * Perfil de Habilitação: leitura de Identidade & Organização via Cliente-Fornecedor (P-43). A
 * Triagem lê, nunca escreve — não é dona do agregado. É **Gateway**, não Repository (decisão P-83,
 * A10 §8): o Repository persiste um agregado do próprio contexto; o Gateway lê o modelo de OUTRO
 * contexto. Consumer-defined, distinto do `IdentidadeGateway` da Governança — só o `tenantId` é
 * compartilhado (Shared Kernel). Devolve o modelo LOCAL conformante `PerfilHabilitacao`: o ACL
 * (adapter, infra) traduz o Perfil externo e constrói os branded IDs — nunca a application (ids.ts).
 */
export interface PerfilGateway {
  porId(id: PerfilId, signal: AbortSignal): Promise<PerfilHabilitacao | null>;
}

/**
 * Anexos do edital (PDFs) baixados pela Ingestão; a Triagem apenas LÊ o texto para alimentar a
 * extração (A17 §4.1). Port distinto do `ObjectStorage` da Ingestão (que armazena bytes): aqui o
 * papel é obter o texto já resolvido de um anexo.
 */
export interface ObjectStorage {
  obterTextoAnexo(ref: string, signal: AbortSignal): Promise<string>;
}

/**
 * Fronteira com o LLM (A17 §4.1). O adapter (`AnthropicLlmGateway`) aplica a defesa de injeção
 * (A11 §2) e devolve a extração JÁ validada por schema — o que não bate é rejeitado
 * (`SaidaLlmInvalidaError`), nunca "consertado". Único ponto do contexto que fala com o modelo.
 */
export interface LlmGateway {
  extrair(entrada: EntradaExtracaoDTO, signal: AbortSignal): Promise<ExtracaoEdital>;
}

/** Publicação de eventos de domínio na fila (Published Language — A03 §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}
