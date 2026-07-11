import { DomainError, EditalId } from '@radar/kernel';
import { LoteExtracaoIndisponivelError } from '../../domain/errors/index.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import type { LlmLoteGateway, ResultadoLote } from '../../application/ports.js';
import {
  FERRAMENTA_EXTRACAO,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from './anthropic-llm-gateway.js';
import { extrairToolInput, paramsExtracao } from './anthropic-extracao-schema.js';
import type { ExtracaoMessageParams, MensagemComConteudo } from './anthropic-extracao-schema.js';

/**
 * Client mínimo de Message Batches, provider-agnóstico — o SDK concreto (`@anthropic-ai/sdk`) é ligado
 * no composition root (P-74); `client.messages.batches` casa estruturalmente com esta interface. Só o
 * contrato mínimo aparece aqui, como nos demais adapters (Sqs/Postgres/S3).
 */
export interface MessageBatchesClient {
  create(body: { requests: BatchRequestItem[] }): Promise<BatchHandle>;
  retrieve(id: string): Promise<BatchHandle>;
  results(id: string): Promise<AsyncIterable<BatchResultItem>>;
}

export interface BatchHandle {
  readonly id: string;
  /** `in_progress` | `canceling` | `ended` (poll até `ended`). */
  readonly processing_status: string;
}

export interface BatchRequestItem {
  readonly custom_id: string;
  readonly params: ExtracaoMessageParams;
}

/** Cada resultado do lote chega FORA DE ORDEM — daí keyar por `custom_id`, nunca por posição. */
export interface BatchResultItem {
  readonly custom_id: string;
  readonly result:
    | { readonly type: 'succeeded'; readonly message: MensagemComConteudo }
    | { readonly type: 'errored'; readonly error?: unknown }
    | { readonly type: 'canceled' }
    | { readonly type: 'expired' };
}

export interface AnthropicBatchLlmGatewayOpts {
  /** Intervalo entre verificações de `processing_status` (default 15s). */
  readonly intervaloPollMs?: number;
  /** Teto de verificações antes de desistir (default 240 ≈ 1h a 15s). */
  readonly maxPolls?: number;
  /** Injetável para teste; default `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * `AnthropicBatchLlmGateway` — transporte em LOTE da extração (RAD-54 · Lever 1 de RAD-53). Reusa a
 * MESMA construção de requisição (`montarRequisicaoExtracao` + `paramsExtracao`) e interpretação de
 * saída (`extrairToolInput` + `interpretarSaidaExtracao`) do caminho síncrono → inferência idêntica; a
 * defesa de injeção (A11 §2, camadas 1–4/6) vale por construção. Muda só o transporte: acumula →
 * `batches.create` → poll `processing_status` até `ended` → resultados keyed por `custom_id`.
 */
export class AnthropicBatchLlmGateway implements LlmLoteGateway {
  private readonly intervaloPollMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly batches: MessageBatchesClient,
    opts: AnthropicBatchLlmGatewayOpts = {},
  ) {
    this.intervaloPollMs = opts.intervaloPollMs ?? 15_000;
    this.maxPolls = opts.maxPolls ?? 240;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async extrairLote(
    entradas: readonly EntradaExtracaoDTO[],
    signal: AbortSignal,
  ): Promise<ResultadoLote[]> {
    if (entradas.length === 0) return [];

    // custom_id = editalId (chave estável). Reprocessar `edital.ingerido` é idempotente (P-45).
    const porEdital = new Map<string, EntradaExtracaoDTO>();
    const requests: BatchRequestItem[] = [];
    for (const entrada of entradas) {
      const customId = String(entrada.editalId);
      porEdital.set(customId, entrada);
      requests.push({ custom_id: customId, params: paramsExtracao(montarRequisicaoExtracao(entrada)) });
    }

    const { id } = await this.batches.create({ requests });
    await this.aguardarConclusao(id, signal);

    const resultados: ResultadoLote[] = [];
    const vistos = new Set<string>();
    // Keyar SEMPRE por custom_id: os resultados vêm fora de ordem (nunca casar por índice).
    for await (const item of await this.batches.results(id)) {
      const entrada = porEdital.get(item.custom_id);
      if (entrada === undefined) continue; // resultado sem edital correspondente — ignora
      vistos.add(item.custom_id);
      resultados.push(this.interpretarItem(entrada, item));
    }

    // Edital pedido mas sem resultado no lote — explícito, para nunca "sumir" silenciosamente.
    for (const entrada of entradas) {
      if (!vistos.has(String(entrada.editalId))) {
        resultados.push({
          editalId: EditalId(entrada.editalId),
          ok: false,
          motivo: 'resultado ausente no lote',
        });
      }
    }
    return resultados;
  }

  /** Um item do lote → agregado (sucesso) ou falha do edital (o lote inteiro NÃO cai por um item). */
  private interpretarItem(entrada: EntradaExtracaoDTO, item: BatchResultItem): ResultadoLote {
    const editalId = EditalId(entrada.editalId);
    if (item.result.type !== 'succeeded') {
      return { editalId, ok: false, motivo: `lote: ${item.result.type}` };
    }
    try {
      const bruto = extrairToolInput(item.result.message, FERRAMENTA_EXTRACAO);
      const extracao = interpretarSaidaExtracao(bruto, entrada);
      return { editalId, ok: true, extracao };
    } catch (err) {
      // Saída fora do schema (camada 3) é falha ESPERADA (DomainError): o item cai, o lote segue.
      // Qualquer outra exceção é bug real — propaga, não vira `ok:false` silencioso.
      if (err instanceof DomainError) return { editalId, ok: false, motivo: err.message };
      throw err;
    }
  }

  /** Poll até `ended`, honrando o AbortSignal a cada volta (P-78). O lote não é latency-sensitive (P-45). */
  private async aguardarConclusao(id: string, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < this.maxPolls; i++) {
      if (signal.aborted) throw new LoteExtracaoIndisponivelError('operação abortada');
      const { processing_status } = await this.batches.retrieve(id);
      if (processing_status === 'ended') return;
      await this.sleep(this.intervaloPollMs);
    }
    throw new LoteExtracaoIndisponivelError(`lote ${id} não concluiu após ${this.maxPolls} verificações`);
  }
}
