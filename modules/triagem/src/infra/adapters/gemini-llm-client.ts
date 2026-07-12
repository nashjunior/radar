import { ExtracaoRecusadaError, SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { LlmClient, LlmExtracaoRequest } from './anthropic-llm-gateway.js';
import { FERRAMENTA_SCHEMA, MAX_TOKENS_EXTRACAO } from './anthropic-extracao-schema.js';

/**
 * Client HTTP mínimo (seam testável). O SDK `@google/generative-ai` NÃO entra no módulo (P-74) —
 * o composition root / demo injeta `fetch` (ou um stub nos testes).
 */
export type GeminiFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

export interface GeminiLlmClientOpts {
  readonly apiKey: string;
  /** Default: `gemini-2.0-flash`. Ignora `req.modelo` (ids Claude do `montarRequisicaoExtracao`). */
  readonly modelo?: string;
  readonly fetchFn?: GeminiFetch;
  /**
   * Gate duro: em `production` o construtor lança. Gemini é adapter de DEV local apenas
   * (P-27/P-66 — produção = Claude/Bedrock).
   */
  readonly nodeEnv?: string | undefined;
}

interface GeminiFunctionCall {
  readonly name?: string;
  readonly args?: unknown;
}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: GeminiFunctionCall;
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[] };
  readonly finishReason?: string;
}

interface GeminiGenerateResponse {
  readonly candidates?: readonly GeminiCandidate[];
  readonly promptFeedback?: { readonly blockReason?: string };
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * `GeminiLlmClient` — transporte síncrono alternativo do seam `LlmClient` para DEV local.
 * Reusa o schema canônico (`FERRAMENTA_SCHEMA`) convertido ao subset aceito pelo Gemini;
 * a saída CRUA da function call segue para `interpretarSaidaExtracao` (camadas 3–6).
 *
 * NÃO é default de produção. Use atrás de `AnthropicLlmGateway` com `LLM_PROVIDER=gemini`.
 */
export class GeminiLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly modelo: string;
  private readonly fetchFn: GeminiFetch;

  constructor(opts: GeminiLlmClientOpts) {
    const env = opts.nodeEnv ?? process.env['NODE_ENV'];
    if (env === 'production') {
      throw new Error(
        'GeminiLlmClient é proibido em NODE_ENV=production (P-27/P-66 — use Claude/Bedrock).',
      );
    }
    if (!opts.apiKey || opts.apiKey.trim().length === 0) {
      throw new Error('GEMINI_API_KEY é obrigatório para GeminiLlmClient.');
    }
    this.apiKey = opts.apiKey.trim();
    this.modelo = opts.modelo?.trim() || 'gemini-2.0-flash';
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async extrairViaFerramenta(req: LlmExtracaoRequest, signal: AbortSignal): Promise<unknown> {
    const url = `${BASE}/models/${encodeURIComponent(this.modelo)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body = {
      system_instruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.userContent }] }],
      tools: [
        {
          function_declarations: [
            {
              name: FERRAMENTA_SCHEMA.name,
              description: FERRAMENTA_SCHEMA.description,
              parameters: schemaParaGemini(FERRAMENTA_SCHEMA.input_schema),
            },
          ],
        },
      ],
      tool_config: {
        function_calling_config: {
          mode: 'ANY',
          allowed_function_names: [req.ferramenta],
        },
      },
      generationConfig: {
        maxOutputTokens: MAX_TOKENS_EXTRACAO,
      },
    };

    const resposta = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => '');
      throw new SaidaLlmInvalidaError(
        `Gemini HTTP ${resposta.status}${detalhe ? `: ${detalhe.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await resposta.json()) as GeminiGenerateResponse;

    if (json.promptFeedback?.blockReason) {
      throw new ExtracaoRecusadaError();
    }

    const candidato = json.candidates?.[0];
    if (!candidato) {
      throw new SaidaLlmInvalidaError('Gemini: resposta sem candidates');
    }

    if (candidato.finishReason === 'SAFETY' || candidato.finishReason === 'BLOCKLIST') {
      throw new ExtracaoRecusadaError();
    }

    const parts = candidato.content?.parts ?? [];
    const chamada = parts.find((p) => p.functionCall)?.functionCall;
    if (!chamada || chamada.name !== req.ferramenta) {
      throw new SaidaLlmInvalidaError(`resposta sem uso da ferramenta "${req.ferramenta}"`);
    }
    if (chamada.args === undefined) {
      throw new SaidaLlmInvalidaError('Gemini: functionCall sem args');
    }
    return chamada.args;
  }
}

/**
 * Converte o JSON Schema do `FERRAMENTA_SCHEMA` (Anthropic/strict) para o subset OpenAPI
 * aceito em `function_declarations.parameters` do Gemini: remove `additionalProperties` /
 * `strict`, e mapeia `anyOf: [T, {type:null}]` → `{...T, nullable:true}`.
 */
export function schemaParaGemini(schema: unknown): Record<string, unknown> {
  return limpar(schema) as Record<string, unknown>;
}

function limpar(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(limpar);
  if (typeof node !== 'object' || node === null) return node;

  const o = node as Record<string, unknown>;

  // anyOf: [schema, { type: 'null' }] → nullable
  if (Array.isArray(o['anyOf']) && o['anyOf'].length === 2) {
    const [a, b] = o['anyOf'] as [unknown, unknown];
    if (ehNullSchema(b)) {
      const base = limpar(a) as Record<string, unknown>;
      return { ...base, nullable: true };
    }
    if (ehNullSchema(a)) {
      const base = limpar(b) as Record<string, unknown>;
      return { ...base, nullable: true };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'additionalProperties' || k === 'strict') continue;
    out[k] = limpar(v);
  }
  return out;
}

function ehNullSchema(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { type?: string }).type === 'null';
}
