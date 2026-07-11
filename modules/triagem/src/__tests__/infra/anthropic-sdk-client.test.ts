import { describe, expect, it, vi } from 'vitest';
import { AnthropicSdkClient, thinkingExtracao } from '../../infra/adapters/anthropic-sdk-client.js';
import type {
  ExtracaoStreamParams,
  LlmClientLogger,
  MensagemFinal,
  MessagesClient,
} from '../../infra/adapters/anthropic-sdk-client.js';
import { FERRAMENTA_EXTRACAO } from '../../infra/adapters/anthropic-llm-gateway.js';
import type { LlmExtracaoRequest } from '../../infra/adapters/anthropic-llm-gateway.js';
import { MAX_TOKENS_EXTRACAO } from '../../infra/adapters/anthropic-extracao-schema.js';
import { ExtracaoRecusadaError, SaidaLlmInvalidaError } from '../../domain/errors/index.js';

const noop = new AbortController().signal;

const INPUT_OK = { objeto: { valor: 'Notebooks', confianca: 0.9, citacao: null } };

function req(modelo = 'claude-sonnet-5'): LlmExtracaoRequest {
  return {
    modelo,
    system: 'instrução fixa',
    userContent: '<edital_nao_confiavel>Objeto: notebooks sigilosos.</edital_nao_confiavel>',
    ferramenta: FERRAMENTA_EXTRACAO,
  };
}

function msg(over: Partial<MensagemFinal> = {}): MensagemFinal {
  return {
    content: [{ type: 'tool_use', name: FERRAMENTA_EXTRACAO, input: INPUT_OK }],
    stop_reason: 'tool_use',
    stop_details: null,
    ...over,
  };
}

interface Captura {
  params?: ExtracaoStreamParams;
  signal?: AbortSignal;
  chamadas: number;
}

function fakeMessages(resposta: MensagemFinal): { client: MessagesClient; cap: Captura } {
  const cap: Captura = { chamadas: 0 };
  const client: MessagesClient = {
    stream(params, opts) {
      cap.params = params;
      cap.signal = opts.signal;
      cap.chamadas += 1;
      return { finalMessage: async () => resposta };
    },
  };
  return { client, cap };
}

describe('AnthropicSdkClient — levers 6+5a (RAD-55)', () => {
  it('lever 1+5a: streaming (.stream().finalMessage()) forçando a ferramenta STRICT', async () => {
    const { client, cap } = fakeMessages(msg());
    const bruto = await new AnthropicSdkClient(client).extrairViaFerramenta(req(), noop);

    expect(cap.chamadas).toBe(1); // 1 request via stream, não create
    expect(cap.params!.max_tokens).toBe(MAX_TOKENS_EXTRACAO);
    expect(cap.params!.tool_choice).toEqual({ type: 'tool', name: FERRAMENTA_EXTRACAO });
    expect(cap.params!.tools[0]!.strict).toBe(true);
    expect(cap.params!.tools[0]!.input_schema['additionalProperties']).toBe(false);
    expect(bruto).toBe(INPUT_OK); // devolve o input CRU (unknown) — validação é da camada 3
  });

  it('lever 4: thinking EXPLÍCITO por modelo (Sonnet 5 adaptive, Opus 4.8 disabled)', async () => {
    const s = fakeMessages(msg());
    await new AnthropicSdkClient(s.client).extrairViaFerramenta(req('claude-sonnet-5'), noop);
    expect(s.cap.params!.thinking).toEqual({ type: 'adaptive' });

    const o = fakeMessages(msg());
    await new AnthropicSdkClient(o.client).extrairViaFerramenta(req('claude-opus-4-8'), noop);
    expect(o.cap.params!.thinking).toEqual({ type: 'disabled' });

    expect(thinkingExtracao('claude-sonnet-5')).toEqual({ type: 'adaptive' });
    expect(thinkingExtracao('claude-opus-4-8')).toEqual({ type: 'disabled' });
  });

  it('lever 4: thinkingPorModelo é injetável (seam do experimento gold set — P-85)', async () => {
    const { client, cap } = fakeMessages(msg());
    await new AnthropicSdkClient(client, {
      thinkingPorModelo: () => ({ type: 'disabled' }),
    }).extrairViaFerramenta(req('claude-sonnet-5'), noop);
    expect(cap.params!.thinking).toEqual({ type: 'disabled' });
  });

  it('P-78: propaga o AbortSignal até o .stream({ signal })', async () => {
    const signal = new AbortController().signal;
    const { client, cap } = fakeMessages(msg());
    await new AnthropicSdkClient(client).extrairViaFerramenta(req(), signal);
    expect(cap.signal).toBe(signal);
  });

  it('lever 6: refusal → ExtracaoRecusadaError ANTES de ler content (nunca fabrica)', async () => {
    const warn = vi.fn();
    const logger: LlmClientLogger = { warn };
    const { client } = fakeMessages(
      msg({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
        content: [], // em recusa o content vem vazio/parcial
      }),
    );

    await expect(
      new AnthropicSdkClient(client, { logger }).extrairViaFerramenta(req(), noop),
    ).rejects.toBeInstanceOf(ExtracaoRecusadaError);

    // log guarda categoria/tipo da política — NUNCA a explanation nem o edital (sem PII)
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0]![1] as Record<string, unknown>;
    expect(meta['categoria']).toBe('cyber');
    expect(meta['tipo']).toBe('refusal');
    expect(JSON.stringify(meta)).not.toContain('notebooks');
  });

  it('lever 6: max_tokens (truncado) → SaidaLlmInvalidaError, não devolve parcial', async () => {
    const { client } = fakeMessages(msg({ stop_reason: 'max_tokens', content: [] }));
    await expect(
      new AnthropicSdkClient(client).extrairViaFerramenta(req(), noop),
    ).rejects.toBeInstanceOf(SaidaLlmInvalidaError);
  });

  it('resposta sem o tool_use forçado → SaidaLlmInvalidaError (camada 3)', async () => {
    const { client } = fakeMessages(msg({ stop_reason: 'end_turn', content: [{ type: 'text' }] }));
    await expect(
      new AnthropicSdkClient(client).extrairViaFerramenta(req(), noop),
    ).rejects.toBeInstanceOf(SaidaLlmInvalidaError);
  });
});
