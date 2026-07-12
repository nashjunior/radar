import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { AnthropicBatchLlmGateway } from '../../infra/adapters/anthropic-batch-llm-gateway.js';
import type {
  BatchRequestItem,
  BatchResultItem,
  MessageBatchesClient,
} from '../../infra/adapters/anthropic-batch-llm-gateway.js';
import {
  FERRAMENTA_EXTRACAO,
  INSTRUCAO_EXTRACAO,
} from '../../infra/adapters/anthropic-llm-gateway.js';
import { FERRAMENTA_SCHEMA } from '../../infra/adapters/anthropic-extracao-schema.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;
const nosleep = async () => {};

function entrada(id: string, texto: string): EntradaExtracaoDTO {
  return { editalId: EditalId(id), texto, temTextoSelecionavel: true, anexos: [], paginas: 3 };
}

/** Input de ferramenta válido — a citação cita `objeto` (casa na camada 6 com `entrada.texto`). */
function toolInput(objeto: string): unknown {
  return {
    objeto: {
      valor: objeto,
      confianca: 0.9,
      citacao: { pagina: 1, secao: null, trecho: objeto.toLowerCase() },
    },
    valorEstimado: { valor: null, confianca: 0.8, citacao: null },
    dataAberturaPropostas: { valor: null, confianca: 0.7, citacao: null },
    requisitos: [],
    riscos: [],
  };
}

function sucesso(customId: string, objeto: string, inputOverride?: unknown): BatchResultItem {
  return {
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: {
        content: [
          { type: 'tool_use', name: FERRAMENTA_EXTRACAO, input: inputOverride ?? toolInput(objeto) },
        ],
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
    },
  };
}

function fakeBatches(
  itens: BatchResultItem[],
  pollsAteEnded = 1,
): { client: MessageBatchesClient; enviados: BatchRequestItem[][] } {
  const enviados: BatchRequestItem[][] = [];
  let polls = 0;
  const client: MessageBatchesClient = {
    create: async ({ requests }) => {
      enviados.push(requests);
      return { id: 'batch-1', processing_status: 'in_progress' };
    },
    retrieve: async () => {
      polls++;
      return { id: 'batch-1', processing_status: polls >= pollsAteEnded ? 'ended' : 'in_progress' };
    },
    results: async () =>
      (async function* () {
        for (const item of itens) yield item;
      })(),
  };
  return { client, enviados };
}

describe('AnthropicBatchLlmGateway — transporte em lote (RAD-54)', () => {
  it('keya por custom_id (=editalId), NUNCA por posição: resultados fora de ordem casam certo', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    // Resultados devolvidos em ordem INVERTIDA à das requisições.
    const { client } = fakeBatches([
      sucesso('B', 'Contratação de limpeza'),
      sucesso('A', 'Aquisição de notebooks'),
    ]);

    const res = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a, b], noop);

    const ra = res.find((r) => r.editalId === EditalId('A'));
    const rb = res.find((r) => r.editalId === EditalId('B'));
    expect(ra?.ok && ra.extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(rb?.ok && rb.extracao.objeto.valor).toBe('Contratação de limpeza');
    // RAD-230: `uso` acompanha CADA item (mesma inferência do síncrono — reconstrói o modelo por entrada).
    expect(ra?.ok && ra.uso).toEqual({
      modelo: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      transporte: 'lote',
    });
  });

  it('monta a requisição igual ao caminho síncrono (custom_id, system, tool, tool_choice)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { client, enviados } = fakeBatches([sucesso('A', 'Aquisição de notebooks')]);

    await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a], noop);

    const req = enviados[0]![0]!;
    expect(req.custom_id).toBe('A');
    expect(req.params.system).toBe(INSTRUCAO_EXTRACAO);
    expect(req.params.tools[0]).toBe(FERRAMENTA_SCHEMA);
    expect(req.params.tool_choice).toEqual({ type: 'tool', name: FERRAMENTA_EXTRACAO });
    expect(req.params.messages[0]!.content).toContain('<edital_nao_confiavel>');
    expect(req.params.messages[0]!.content).toContain('aquisição de notebooks');
  });

  it('resultado errored/expired vira falha do item — o lote NÃO cai por um item', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    const { client } = fakeBatches([
      { custom_id: 'A', result: { type: 'errored', error: { type: 'overloaded_error' } } },
      { custom_id: 'B', result: { type: 'expired' } },
    ]);

    const res = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a, b], noop);

    expect(res.find((r) => r.editalId === EditalId('A'))).toMatchObject({ ok: false, motivo: 'lote: errored' });
    expect(res.find((r) => r.editalId === EditalId('B'))).toMatchObject({ ok: false, motivo: 'lote: expired' });
  });

  it('sucesso com saída fora do schema (camada 3) vira falha, não é "consertado"', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const invalido = toolInput('Aquisição de notebooks') as { objeto: { confianca: number } };
    invalido.objeto.confianca = 1.5; // fora de [0,1]
    const { client } = fakeBatches([sucesso('A', 'x', invalido)]);

    const [res] = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a], noop);
    expect(res!.ok).toBe(false);
  });

  it('edital pedido sem resultado no lote é marcado ausente (não some silenciosamente)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    const { client } = fakeBatches([sucesso('A', 'Aquisição de notebooks')]); // sem B

    const res = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a, b], noop);
    expect(res.find((r) => r.editalId === EditalId('B'))).toMatchObject({
      ok: false,
      motivo: 'resultado ausente no lote',
    });
  });

  it('faz poll de processing_status até ended', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { client } = fakeBatches([sucesso('A', 'Aquisição de notebooks')], 3);

    const [res] = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a], noop);
    expect(res!.ok).toBe(true);
  });

  it('honra o AbortSignal (P-78): aborta durante o poll', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { client } = fakeBatches([sucesso('A', 'Aquisição de notebooks')], 5);
    const abortado = AbortSignal.abort();

    await expect(
      new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([a], abortado),
    ).rejects.toThrow(/abortada/);
  });

  it('lote vazio não chama o provedor', async () => {
    const { client, enviados } = fakeBatches([]);
    const res = await new AnthropicBatchLlmGateway(client, { sleep: nosleep }).extrairLote([], noop);
    expect(res).toEqual([]);
    expect(enviados).toHaveLength(0);
  });
});
