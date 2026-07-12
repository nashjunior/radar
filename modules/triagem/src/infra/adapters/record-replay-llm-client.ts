import type { LlmClient, LlmExtracaoRequest, ResultadoExtracaoClient } from './anthropic-llm-gateway.js';

/**
 * Chave determinística de um caso do gold set a partir da requisição. Default: o `userContent`
 * (o edital delimitado), único por edital — o `editalId` NÃO trafega até o `LlmClient`
 * (`LlmExtracaoRequest` só carrega modelo/system/userContent/ferramenta), então a chave sai do
 * conteúdo. O harness pode injetar outra (ex.: hash, ou um id do dataset).
 */
export type ChaveCaso = (req: LlmExtracaoRequest) => string;

export const chavePorConteudo: ChaveCaso = (req) => req.userContent;

/**
 * REPLAY sem fixture para a chave pedida e SEM `delegate` para gravar. É erro de HARNESS (fixture
 * faltando no dataset), nunca condição de runtime — por isso NÃO é `DomainError` e não mapeia a HTTP.
 */
export class FixtureDeGoldSetAusenteError extends Error {
  readonly code = 'FIXTURE_GOLD_SET_AUSENTE' as const;
  constructor(readonly chave: string) {
    super('sem saída de LLM gravada para a chave do gold set (e sem delegate para gravá-la)');
    this.name = 'FixtureDeGoldSetAusenteError';
  }
}

export interface RecordReplayLlmClientOpts {
  /** Client REAL (ex.: `AnthropicSdkClient`) usado só no modo RECORD, em cache-miss de fixture. */
  readonly delegate?: LlmClient;
  /** Derivação da chave do caso. Default: `chavePorConteudo`. */
  readonly chave?: ChaveCaso;
  /** Captura do modo RECORD — o harness persiste `{chave → saida}` como fixture do dataset. */
  readonly onRecord?: (chave: string, saida: unknown) => void;
}

/**
 * REPLAY não chama o provedor — não há chamada real a medir. Zero é o valor CORRETO (RAD-230), não
 * um placeholder: o gold set existe justamente para rodar sem custo (docstring da classe).
 */
const USO_REPLAY_ZERO = {
  modelo: 'replay',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  transporte: 'on_demand',
} as const;

/**
 * `RecordReplayLlmClient` — o seam do gold set (A17 §7 / A16 §2.3) prometido em
 * `anthropic-llm-gateway.ts`: roda o pipeline REAL de extração (`montarRequisicaoExtracao` →
 * `interpretarSaidaExtracao`, camadas 1–6) contra saídas de LLM GRAVADAS, sem custo nem flakiness
 * de rede. Implementa o mesmo `LlmClient` que o `AnthropicSdkClient`, então injeta direto no
 * `AnthropicLlmGateway` sem tocar o resto do pipeline.
 *
 * - **REPLAY (default, SEM credencial):** devolve a saída crua gravada para `chave(req)`. É o gate de
 *   regressão do CI (A17 §7: roda a cada mudança de `INSTRUCAO_EXTRACAO`/modelo/schema — o pipeline
 *   determinístico é reavaliado sem tocar o provedor). Sem fixture e sem `delegate` → erro de harness.
 * - **RECORD (com `delegate` real):** em cache-miss chama o client real UMA vez, entrega a captura a
 *   `onRecord` (o harness materializa/atualiza as fixtures) e a devolve. Passo credenciado e ocasional.
 *
 * **Framework-agnóstico (não pressupõe P-85):** é o SUBSTRATO determinístico que qualquer escolha de
 * framework de eval (Braintrust/Phoenix/custom) usa para não repagar o LLM a cada run; dataset, score
 * e relatório ficam no framework, não aqui. Também não decide limiares (P-19) nem rótulos (Quésia/A16)
 * — só torna o pipeline reproduzível.
 */
export class RecordReplayLlmClient implements LlmClient {
  private readonly chave: ChaveCaso;

  constructor(
    private readonly fixtures: ReadonlyMap<string, unknown>,
    private readonly opts: RecordReplayLlmClientOpts = {},
  ) {
    this.chave = opts.chave ?? chavePorConteudo;
  }

  async extrairViaFerramenta(
    req: LlmExtracaoRequest,
    signal: AbortSignal,
  ): Promise<ResultadoExtracaoClient> {
    const chave = this.chave(req);
    if (this.fixtures.has(chave)) {
      return { input: this.fixtures.get(chave), uso: USO_REPLAY_ZERO };
    }
    const { delegate, onRecord } = this.opts;
    if (delegate !== undefined) {
      const resultado = await delegate.extrairViaFerramenta(req, signal);
      onRecord?.(chave, resultado.input); // fixture grava só o INPUT — `uso` não é reproduzível no REPLAY
      return resultado;
    }
    throw new FixtureDeGoldSetAusenteError(chave);
  }

  /**
   * REPLAY (sem `delegate`) não paga por `count_tokens` real (RAD-243) — devolve 0, para o admission
   * control nunca rejeitar um caso do gold set por um teto que não se aplica a fixtures reproduzidas.
   * RECORD (com `delegate`) repassa ao client real — o mesmo padrão de `extrairViaFerramenta` acima.
   */
  async contarTokensDeEntrada(req: LlmExtracaoRequest, signal: AbortSignal): Promise<number> {
    const { delegate } = this.opts;
    return delegate !== undefined ? delegate.contarTokensDeEntrada(req, signal) : 0;
  }
}
