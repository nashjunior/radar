import { ExtracaoRecusadaError, SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { LlmClient, LlmExtracaoRequest, ResultadoExtracaoClient } from './anthropic-llm-gateway.js';
import { extrairToolInput, paramsExtracao, usoDeMensagem } from './anthropic-extracao-schema.js';
import type { ExtracaoMessageParams, MensagemComConteudo } from './anthropic-extracao-schema.js';

/**
 * `thinking` explícito por modelo (lever 4). A extração só usa adaptive|disabled — nunca `budget_tokens`
 * (removido em Sonnet 5 / Opus 4.8). Subconjunto do `ThinkingConfigParam` do SDK (casa estruturalmente).
 */
export type ThinkingConfig = { readonly type: 'adaptive' } | { readonly type: 'disabled' };

/** Params de streaming = os `ExtracaoMessageParams` compartilhados (sync ↔ lote) + `thinking` explícito. */
export interface ExtracaoStreamParams extends ExtracaoMessageParams {
  readonly thinking: ThinkingConfig;
}

/**
 * Resposta final do stream — só o que o adapter lê: `content` (p/ `extrairToolInput`) e
 * `stop_reason`/`stop_details` (refusal). Casa com `Message` do SDK.
 */
export interface MensagemFinal extends MensagemComConteudo {
  readonly stop_reason: string | null;
  readonly stop_details: { readonly type?: string; readonly category?: string | null } | null;
}

interface MessageStreamLike {
  finalMessage(): Promise<MensagemFinal>;
}

/** Params mínimos de `POST /v1/messages/count_tokens` (RAD-243, admission control) — subconjunto de
 * `ExtracaoMessageParams` (sem `max_tokens`/`tool_choice`, que o endpoint não aceita). */
export interface ContagemTokensParams {
  readonly model: string;
  readonly system: string;
  readonly messages: ExtracaoMessageParams['messages'];
  readonly tools: ExtracaoMessageParams['tools'];
}

/** Resposta de `count_tokens` — casa com `MessageTokensCount` do SDK. */
export interface ContagemTokens {
  readonly input_tokens: number;
}

/**
 * Client mínimo de mensagens (STREAMING), provider-agnóstico — o SDK concreto (`@anthropic-ai/sdk`) é
 * ligado no composition root (P-74); `client.messages` casa estruturalmente com esta interface. Só o
 * contrato mínimo aparece aqui, como nos demais adapters (Batches/Sqs/Postgres/S3). O `AbortSignal`
 * (P-78) vai em `opts.signal` → chega ao `.stream({ signal })`.
 *
 * `countTokens` (RAD-243, P-20/P-38 admission control) é endpoint GRÁTIS (billing) e com RPM PRÓPRIO,
 * separado do rate limit de `stream`/`create` — chamá-lo antes da extração não consome a cota de
 * geração nem soma custo (fonte: docs.claude.com/.../token-counting, "Token counting is free to use").
 */
export interface MessagesClient {
  stream(params: ExtracaoStreamParams, opts: { signal: AbortSignal }): MessageStreamLike;
  countTokens(params: ContagemTokensParams, opts: { signal: AbortSignal }): Promise<ContagemTokens>;
}

/** Log mínimo p/ registrar recusas SEM PII (só metadados de política). Default: `console`. */
export interface LlmClientLogger {
  warn(mensagem: string, meta: Record<string, unknown>): void;
}

const consoleLogger: LlmClientLogger = {
  warn: (mensagem, meta) => {
    console.warn(mensagem, meta);
  },
};

export interface AnthropicSdkClientOpts {
  readonly logger?: LlmClientLogger;
  /** Override do thinking por modelo — seam para o experimento do gold set (P-85, Tier B). */
  readonly thinkingPorModelo?: (modelo: string) => ThinkingConfig;
}

/**
 * `AnthropicSdkClient` — impl SÍNCRONA e concreta do seam `LlmClient` (a ÚNICA peça tech-specific do
 * caminho síncrono). Reusa `paramsExtracao`/`FERRAMENTA_SCHEMA` (com `strict: true`) e `extrairToolInput`
 * do módulo — MESMA inferência do lote (`AnthropicBatchLlmGateway`), só muda o transporte. Levers 6+5a
 * de RAD-53 (RAD-55):
 *   1. STREAMING + `finalMessage()` — o SDK recusa requests não-stream longos; editais grandes rendem
 *      saída extensa. `AbortSignal` (P-78) propaga até `.stream({ signal })`.
 *   2. `stop_reason: "refusal"` tratado ANTES de ler `content` (em recusa o content vem vazio/parcial):
 *      mapeia p/ `ExtracaoRecusadaError` (→ 422 na borda), NUNCA fabrica extração; `stop_details` no
 *      log SEM PII (só categoria/tipo da política).
 *   3. `strict: true` (via `FERRAMENTA_SCHEMA`): `tool_use.input` schema-válido → menos `SaidaLlmInvalida`/retry.
 *   4. `thinking` EXPLÍCITO por modelo (`thinkingExtracao`): não gastar raciocínio às cegas.
 * O SDK NÃO é importado aqui (P-74) — o composition root passa `anthropic.messages` como `MessagesClient`.
 */
export class AnthropicSdkClient implements LlmClient {
  private readonly logger: LlmClientLogger;
  private readonly resolverThinking: (modelo: string) => ThinkingConfig;

  constructor(
    private readonly messages: MessagesClient,
    opts: AnthropicSdkClientOpts = {},
  ) {
    this.logger = opts.logger ?? consoleLogger;
    this.resolverThinking = opts.thinkingPorModelo ?? thinkingExtracao;
  }

  async extrairViaFerramenta(
    req: LlmExtracaoRequest,
    signal: AbortSignal,
  ): Promise<ResultadoExtracaoClient> {
    const params: ExtracaoStreamParams = {
      ...paramsExtracao(req),
      thinking: this.resolverThinking(req.modelo),
    };

    // Lever 1 — streaming + finalMessage (editais grandes; o SDK recusa não-stream longo). P-78: signal.
    const mensagem = await this.messages.stream(params, { signal }).finalMessage();

    // Lever 6 — refusal ANTES de ler content: em recusa o content vem vazio/parcial; nunca fabricar.
    // GAP fechado (RAD-243): `mensagem.usage` já reflete tokens gastos aqui — anexa `usoParcial` ao
    // erro para o caller registrar o custo real no ledger mesmo a extração tendo sido recusada.
    if (mensagem.stop_reason === 'refusal') {
      this.logger.warn('[triagem] extração recusada pelo modelo (stop_reason=refusal)', {
        modelo: req.modelo,
        categoria: mensagem.stop_details?.category ?? null, // categoria da política — SEM PII
        tipo: mensagem.stop_details?.type ?? null,
      });
      throw new ExtracaoRecusadaError(usoDeMensagem(mensagem, req.modelo, 'on_demand'));
    }

    // Truncamento por max_tokens → tool_use possivelmente incompleto: saída não-confiável, não fabrica.
    // GAP fechado (RAD-243): mesmo tratamento do refusal acima — `usoParcial` carrega o custo já gasto.
    if (mensagem.stop_reason === 'max_tokens') {
      throw new SaidaLlmInvalidaError(
        'resposta truncada (max_tokens)',
        usoDeMensagem(mensagem, req.modelo, 'on_demand'),
      );
    }

    // Ausência do tool_use forçado também é rejeitada (camada 3, dentro de extrairToolInput).
    return {
      input: extrairToolInput(mensagem, req.ferramenta),
      uso: usoDeMensagem(mensagem, req.modelo, 'on_demand'),
    };
  }

  /**
   * Admission control (RAD-243, P-20/P-38) — `count_tokens` da MESMA requisição que `extrairViaFerramenta`
   * enviaria (mesmo `system`/`messages`/`tools`, sem `max_tokens`/`tool_choice`, que o endpoint não aceita),
   * ANTES de pagar pela geração. Grátis e com RPM próprio (ver docstring de `MessagesClient`).
   */
  async contarTokensDeEntrada(req: LlmExtracaoRequest, signal: AbortSignal): Promise<number> {
    const { model, system, messages, tools } = paramsExtracao(req);
    const contagem = await this.messages.countTokens({ model, system, messages, tools }, { signal });
    return contagem.input_tokens;
  }
}

/**
 * Lever 4 (RAD-55) — thinking EXPLÍCITO por modelo, fixando o default IMPLÍCITO de cada um (declarado,
 * nunca às cegas): Sonnet 5 omitido = adaptive; Opus 4.8 omitido = SEM thinking. Preserva a saída dos
 * dois. DESLIGAR onde estava ligado (Sonnet → disabled) é ganho de custo que MUDA a saída → Tier B,
 * gated no gold set (P-85): não é feito aqui — injete via `thinkingPorModelo` para esse experimento.
 */
export function thinkingExtracao(modelo: string): ThinkingConfig {
  return modelo.startsWith('claude-opus') ? { type: 'disabled' } : { type: 'adaptive' };
}
