import { describe, expect, it, vi } from 'vitest';
import { FERRAMENTA_EXTRACAO } from '../../infra/adapters/anthropic-llm-gateway.js';
import {
  AnthropicLlmGateway,
  montarRequisicaoExtracao,
} from '../../infra/adapters/anthropic-llm-gateway.js';
import type { LlmExtracaoRequest } from '../../infra/adapters/anthropic-llm-gateway.js';
import { GeminiLlmClient, schemaParaGemini } from '../../infra/adapters/gemini-llm-client.js';
import type { GeminiFetch } from '../../infra/adapters/gemini-llm-client.js';
import { ExtracaoRecusadaError, SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;

const ARGS_OK = {
  objeto: {
    valor: 'Aquisição de notebooks',
    confianca: 0.9,
    citacao: { pagina: 1, secao: null, trecho: 'Aquisição de notebooks' },
  },
  valorEstimado: { valor: 100000, confianca: 0.8, citacao: null },
  dataAberturaPropostas: { valor: null, confianca: 0.5, citacao: null },
  requisitos: [
    {
      categoria: 'juridica',
      descricao: 'Certidão negativa de débitos',
      citacao: { pagina: 1, secao: null, trecho: 'Certidão negativa de débitos' },
    },
  ],
  riscos: [],
};

function req(): LlmExtracaoRequest {
  return {
    modelo: 'claude-sonnet-5',
    system: 'instrução fixa',
    userContent:
      '<edital_nao_confiavel>\nAquisição de notebooks. Certidão negativa de débitos.\n</edital_nao_confiavel>',
    ferramenta: FERRAMENTA_EXTRACAO,
  };
}

function fakeFetch(payload: unknown, status = 200): GeminiFetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as GeminiFetch;
}

describe('GeminiLlmClient', () => {
  it('recusa construção em NODE_ENV=production', () => {
    expect(
      () => new GeminiLlmClient({ apiKey: 'k', nodeEnv: 'production' }),
    ).toThrow(/proibido em NODE_ENV=production/);
  });

  it('exige apiKey', () => {
    expect(() => new GeminiLlmClient({ apiKey: '  ', nodeEnv: 'development' })).toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('devolve args da function call (unknown) — validação fica na camada 3', async () => {
    const fetchFn = fakeFetch({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: FERRAMENTA_EXTRACAO, args: ARGS_OK } }],
          },
          finishReason: 'STOP',
        },
      ],
    });
    const client = new GeminiLlmClient({
      apiKey: 'test-key',
      nodeEnv: 'development',
      fetchFn,
      modelo: 'gemini-2.0-flash',
    });

    const bruto = await client.extrairViaFerramenta(req(), noop);
    expect(bruto).toEqual(ARGS_OK);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body) as {
      tools: { function_declarations: { name: string }[] }[];
      tool_config: { function_calling_config: { allowed_function_names: string[] } };
    };
    expect(body.tools[0]!.function_declarations[0]!.name).toBe(FERRAMENTA_EXTRACAO);
    expect(body.tool_config.function_calling_config.allowed_function_names).toEqual([
      FERRAMENTA_EXTRACAO,
    ]);
  });

  it('mapeia blockReason / SAFETY → ExtracaoRecusadaError', async () => {
    const blocked = new GeminiLlmClient({
      apiKey: 'k',
      nodeEnv: 'test',
      fetchFn: fakeFetch({ promptFeedback: { blockReason: 'SAFETY' } }),
    });
    await expect(blocked.extrairViaFerramenta(req(), noop)).rejects.toThrow(ExtracaoRecusadaError);

    const safety = new GeminiLlmClient({
      apiKey: 'k',
      nodeEnv: 'test',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
      }),
    });
    await expect(safety.extrairViaFerramenta(req(), noop)).rejects.toThrow(ExtracaoRecusadaError);
  });

  it('rejeita ausência da ferramenta', async () => {
    const client = new GeminiLlmClient({
      apiKey: 'k',
      nodeEnv: 'test',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [{ text: 'olá' }] }, finishReason: 'STOP' }],
      }),
    });
    await expect(client.extrairViaFerramenta(req(), noop)).rejects.toThrow(SaidaLlmInvalidaError);
  });

  it('passa por AnthropicLlmGateway → interpretarSaidaExtracao (fixture)', async () => {
    const fetchFn = fakeFetch({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: FERRAMENTA_EXTRACAO, args: ARGS_OK } }],
          },
        },
      ],
    });
    const entrada: EntradaExtracaoDTO = {
      editalId: 'edital-demo-1',
      texto: 'Aquisição de notebooks. Certidão negativa de débitos.',
      temTextoSelecionavel: true,
      anexos: [],
      paginas: 1,
    };
    const gateway = new AnthropicLlmGateway(
      new GeminiLlmClient({ apiKey: 'k', nodeEnv: 'test', fetchFn }),
    );
    const extracao = await gateway.extrair(entrada, noop);
    expect(extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(extracao.requisitos).toHaveLength(1);
    // montarRequisicao ainda escolhe id Claude — o client Gemini ignora
    expect(montarRequisicaoExtracao(entrada).modelo).toMatch(/^claude-/);
  });
});

describe('schemaParaGemini', () => {
  it('remove additionalProperties e converte anyOf nullável', () => {
    const out = schemaParaGemini({
      type: 'object',
      additionalProperties: false,
      properties: {
        valor: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    });
    expect(out['additionalProperties']).toBeUndefined();
    expect(out['properties']).toEqual({
      valor: { type: 'number', nullable: true },
    });
  });
});
