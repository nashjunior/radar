import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
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

/**
 * Triagem é escopada ao tenant/cliente (P-49). A leitura por chave natural recebe o ESCOPO
 * (`tenantId`/`clienteFinalId`) além do sub-key (`editalId`/`perfilId`): a chave única do agregado é
 * `(tenant, edital, perfil)` (P-45), então filtrar só por `(edital, perfil)` não é único sob
 * multi-tenant (A01 §6) — carregaria uma linha arbitrária de OUTRO tenant. Escopar a query fecha isso
 * na origem; o authz POR OBJETO do use case (A17 §5.3, P-51) permanece como defesa em profundidade.
 */
export interface TriagemRepository {
  salvar(triagem: Triagem, signal: AbortSignal): Promise<void>;
  porEditalEPerfil(
    tenantId: TenantId,
    clienteFinalId: ClienteFinalId,
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

/**
 * Resultado POR edital de uma extração em lote (não é um `Result<>` de erro; é o desfecho de cada item
 * de um lote parcialmente falho). `ok:false` marca o edital que o provedor não entregou (errored/
 * expired) ou cuja saída não passou no schema — o item cai fora, o lote segue.
 */
export type ResultadoLote =
  | { readonly editalId: EditalId; readonly ok: true; readonly extracao: ExtracaoEdital }
  | { readonly editalId: EditalId; readonly ok: false; readonly motivo: string };

/**
 * Fronteira com o LLM em LOTE (RAD-54 · Lever 1 de RAD-53 — Message Batches, −50% de custo). MESMA
 * inferência do `LlmGateway` síncrono (model/system/schema idênticos), só o transporte muda. Cada item
 * é keyed por `editalId` (= `custom_id`, NUNCA por posição — resultados chegam fora de ordem). NÃO é
 * latency-sensitive (P-45): roda assíncrono em `edital.ingerido`, antes de o usuário pedir triagem.
 */
export interface LlmLoteGateway {
  extrairLote(entradas: readonly EntradaExtracaoDTO[], signal: AbortSignal): Promise<ResultadoLote[]>;
}

/** Publicação de eventos de domínio na fila (Published Language — A03 §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// ACL para leitura cross-contexto Ingestão → Triagem (docs/13 §5, P-96).
// Triagem lê apenas o contrato publicado pelo Open-Host da Ingestão —
// nunca acessa a base da Ingestão diretamente (dependency aponta pra dentro do core).
// ---------------------------------------------------------------------------

/** Ref de um documento materializado no object storage. */
export interface ArquivoRef {
  readonly nome: string;
  readonly storageKey: string;
  readonly tipoMime: string;
}

/** Conjunto de refs de documentos de um edital, já disponíveis para leitura. */
export interface DocumentosRef {
  readonly editalId: EditalId;
  readonly arquivos: readonly ArquivoRef[];
}

/**
 * Gateway (ACL) para obter as referências de documentos de um edital.
 * Implementado por um adapter no composition root (apps/api) que chama o
 * `DocumentosDoEditalPort` do módulo Ingestão — a Triagem nunca vê o modelo interno.
 */
export interface DocumentosEditalGateway {
  obterRefs(editalId: EditalId, signal: AbortSignal): Promise<DocumentosRef>;
}
