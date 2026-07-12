import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import {
  BedrockBatchLlmGateway,
  MODELO_BATCH_BEDROCK_PADRAO,
  resolverModeloBatchPadrao,
} from '../../infra/adapters/bedrock-batch-llm-gateway.js';
import type {
  BedrockBatchJobClient,
  BedrockBatchOutputLine,
  BedrockBatchStorageClient,
  BedrockInvokeClient,
  BedrockJobStatus,
} from '../../infra/adapters/bedrock-batch-llm-gateway.js';
import { FERRAMENTA_EXTRACAO } from '../../infra/adapters/anthropic-llm-gateway.js';
import { calcularCustoUsd } from '../../application/precificacao-llm.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import type { MensagemComConteudo } from '../../infra/adapters/anthropic-extracao-schema.js';

const noop = new AbortController().signal;
const nosleep = async () => {};
const REFS = { inputRef: 's3://bucket/batch/input', outputRef: 's3://bucket/batch/output', roleArn: 'arn:aws:iam::123:role/bedrock-batch' };

function entrada(id: string, texto: string): EntradaExtracaoDTO {
  return { editalId: EditalId(id), texto, temTextoSelecionavel: true, anexos: [], paginas: 3 };
}

/** Edital "difícil" (>60k chars) força o tier Opus no router síncrono (`escolherModelo`). */
function entradaDificil(id: string): EntradaExtracaoDTO {
  return entrada(id, `Objeto: obra de grande porte. ${'x'.repeat(61_000)}`);
}

const USO_FAKE = { input_tokens: 100, output_tokens: 50 };

/** Input de ferramenta válido — a citação cita `objeto` (casa na camada 6 com `entrada.texto`). */
function toolInput(objeto: string): unknown {
  return {
    objeto: { valor: objeto, confianca: 0.9, citacao: { pagina: 1, secao: null, trecho: objeto.toLowerCase() } },
    valorEstimado: { valor: null, confianca: 0.8, citacao: null },
    dataAberturaPropostas: { valor: null, confianca: 0.7, citacao: null },
    requisitos: [],
    riscos: [],
  };
}

function mensagem(objeto: string, inputOverride?: unknown): MensagemComConteudo {
  return {
    content: [{ type: 'tool_use', name: FERRAMENTA_EXTRACAO, input: inputOverride ?? toolInput(objeto) }],
    usage: USO_FAKE,
  };
}

function linhaSucesso(recordId: string, objeto: string, inputOverride?: unknown): BedrockBatchOutputLine {
  return { recordId, modelOutput: mensagem(objeto, inputOverride) };
}

function fakeJob(
  linhas: BedrockBatchOutputLine[],
  opts: { pollsAteCompleted?: number; statusFinal?: BedrockJobStatus } = {},
): { jobs: BedrockBatchJobClient; storage: BedrockBatchStorageClient; entradasEscritas: string[] } {
  const pollsAteCompleted = opts.pollsAteCompleted ?? 1;
  const statusFinal = opts.statusFinal ?? 'Completed';
  let polls = 0;
  const entradasEscritas: string[] = [];
  const jobs: BedrockBatchJobClient = {
    create: async () => ({ jobArn: 'arn:job-1' }),
    retrieve: async () => {
      polls++;
      return { status: polls >= pollsAteCompleted ? statusFinal : 'InProgress' };
    },
  };
  const storage: BedrockBatchStorageClient = {
    put: async (_ref, conteudo) => {
      entradasEscritas.push(conteudo);
    },
    get: async () => linhas.map((l) => JSON.stringify(l)).join('\n'),
  };
  return { jobs, storage, entradasEscritas };
}

const semOnDemand: BedrockInvokeClient = {
  invoke: async () => {
    throw new Error('não deveria chamar on-demand neste teste');
  },
};

describe('BedrockBatchLlmGateway — transporte em lote via CreateModelInvocationJob (RAD-237)', () => {
  it('keya por recordId (=editalId sanitizado), NUNCA por posição: resultados fora de ordem casam certo', async () => {
    const a = entrada('11111111-aaaa-1111-aaaa-111111111111', 'Objeto: aquisição de notebooks.');
    const b = entrada('22222222-bbbb-2222-bbbb-222222222222', 'Objeto: contratação de limpeza.');
    const { jobs, storage } = fakeJob([
      linhaSucesso('22222222bbbb2222bbbb222222222222', 'Contratação de limpeza'),
      linhaSucesso('11111111aaaa1111aaaa111111111111', 'Aquisição de notebooks'),
    ]);

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 2,
      sleep: nosleep,
    });
    const res = await gw.extrairLote([a, b], noop);

    const ra = res.find((r) => r.editalId === a.editalId);
    const rb = res.find((r) => r.editalId === b.editalId);
    expect(ra?.ok && ra.extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(rb?.ok && rb.extracao.objeto.valor).toBe('Contratação de limpeza');
    expect(ra?.ok && ra.uso.inputTokens).toBe(100);
    // RAD-340: saiu do CreateModelInvocationJob — transporte em lote, −50% se aplica no ledger.
    expect(ra?.ok && ra.uso.transporte).toBe('lote');
  });

  it('agrupa por modelo e dispara UM JOB POR TIER (Sonnet vs Opus) — a API não mistura modelos num job', async () => {
    const facil = entrada('A', 'Objeto: aquisição de notebooks.');
    const dificil = entradaDificil('B');
    let jobsCriados = 0;
    const modelIds: string[] = [];
    const jobs: BedrockBatchJobClient = {
      create: async (input) => {
        jobsCriados++;
        modelIds.push(input.modelId);
        return { jobArn: `arn:job-${jobsCriados}` };
      },
      retrieve: async () => ({ status: 'Completed' }),
    };
    // Conteúdo da saída é irrelevante aqui — o teste valida só o agrupamento (nº de jobs + modelId de cada um).
    const storage: BedrockBatchStorageClient = { put: async () => {}, get: async () => '' };

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    await gw.extrairLote([facil, dificil], noop);

    expect(jobsCriados).toBe(2);
    expect(new Set(modelIds)).toEqual(
      new Set([MODELO_BATCH_BEDROCK_PADRAO['claude-sonnet-5'], MODELO_BATCH_BEDROCK_PADRAO['claude-opus-4-8']]),
    );
  });

  it('resolverModeloBatchPadrao mapeia os dois tiers síncronos (P-93) e lança para modelo desconhecido', () => {
    expect(resolverModeloBatchPadrao('claude-sonnet-5')).toBe('anthropic.claude-sonnet-4-6-v1:0');
    expect(resolverModeloBatchPadrao('claude-opus-4-8')).toBe('anthropic.claude-opus-4-6-v1:0');
    expect(() => resolverModeloBatchPadrao('claude-desconhecido')).toThrow(/sem par batch-capable/);
  });

  it('item com `error` (sem modelOutput) vira falha do item — o lote NÃO cai por um item', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    const { jobs, storage } = fakeJob([
      { recordId: recordIdOf(a), error: { errorCode: 'ModelError', errorMessage: 'overloaded' } },
      { recordId: recordIdOf(b), error: { errorCode: 'ThrottlingException' } },
    ]);

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 2,
      sleep: nosleep,
    });
    const res = await gw.extrairLote([a, b], noop);

    expect(res.find((r) => r.editalId === a.editalId)).toMatchObject({ ok: false, motivo: 'lote: overloaded' });
    expect(res.find((r) => r.editalId === b.editalId)).toMatchObject({
      ok: false,
      motivo: 'lote: ThrottlingException',
    });
  });

  it('sucesso com saída fora do schema (camada 3) vira falha, não é "consertado"', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const invalido = toolInput('x') as { objeto: { confianca: number } };
    invalido.objeto.confianca = 1.5; // fora de [0,1]
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'x', invalido)]);

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const [res] = await gw.extrairLote([a], noop);
    expect(res!.ok).toBe(false);
  });

  it('edital pedido sem resultado no lote é marcado ausente (não some silenciosamente)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')]); // sem B

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 2,
      sleep: nosleep,
    });
    const res = await gw.extrairLote([a, b], noop);
    expect(res.find((r) => r.editalId === b.editalId)).toMatchObject({
      ok: false,
      motivo: 'resultado ausente no lote',
    });
  });

  it('faz poll até status terminal (Completed)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')], {
      pollsAteCompleted: 3,
    });

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const [res] = await gw.extrairLote([a], noop);
    expect(res!.ok).toBe(true);
  });

  it('PartiallyCompleted também é terminal de sucesso (lê a saída disponível)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')], {
      statusFinal: 'PartiallyCompleted',
    });

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const [res] = await gw.extrairLote([a], noop);
    expect(res!.ok).toBe(true);
  });

  it('status terminal de FALHA (Failed/Stopped/Expired) lança LoteExtracaoIndisponivelError', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([], { statusFinal: 'Failed' });

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    await expect(gw.extrairLote([a], noop)).rejects.toThrow(/status Failed/);
  });

  it('honra o AbortSignal (P-78): aborta durante o poll', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')], {
      pollsAteCompleted: 5,
    });
    const abortado = AbortSignal.abort();

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    await expect(gw.extrairLote([a], abortado)).rejects.toThrow(/abortada/);
  });

  it('lote vazio não chama o provedor', async () => {
    let chamou = false;
    const jobs: BedrockBatchJobClient = {
      create: async () => {
        chamou = true;
        return { jobArn: 'x' };
      },
      retrieve: async () => ({ status: 'Completed' }),
    };
    const storage: BedrockBatchStorageClient = { put: async () => {}, get: async () => '' };

    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const res = await gw.extrairLote([], noop);
    expect(res).toEqual([]);
    expect(chamou).toBe(false);
  });

  it('grupo ABAIXO do mínimo de registros cai no fallback on-demand (sem chamar CreateModelInvocationJob)', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    let jobCriado = false;
    const jobs: BedrockBatchJobClient = {
      create: async () => {
        jobCriado = true;
        return { jobArn: 'x' };
      },
      retrieve: async () => ({ status: 'Completed' }),
    };
    const storage: BedrockBatchStorageClient = { put: async () => {}, get: async () => '' };
    let onDemandChamado = 0;
    const onDemand: BedrockInvokeClient = {
      invoke: async () => {
        onDemandChamado++;
        return mensagem('Aquisição de notebooks (on-demand)');
      },
    };

    const gw = new BedrockBatchLlmGateway(jobs, storage, onDemand, REFS, {
      minimoRegistrosPorJob: 5, // 1 entrada < 5 → fallback
      sleep: nosleep,
    });
    const [res] = await gw.extrairLote([a], noop);

    expect(jobCriado).toBe(false);
    expect(onDemandChamado).toBe(1);
    expect(res!.ok && res!.extracao.objeto.valor).toBe('Aquisição de notebooks (on-demand)');
    // RAD-340: fallback é o `BedrockInvokeClient` direto, sem desconto de lote — preço CHEIO.
    expect(res!.ok && res!.uso.transporte).toBe('on_demand');
  });

  it('RAD-340: mesmo consumo de tokens, custo do job de lote é a METADE do fallback on-demand', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')]);
    const gwLote = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const [resLote] = await gwLote.extrairLote([a], noop);

    const onDemand: BedrockInvokeClient = {
      invoke: async () => mensagem('Aquisição de notebooks'),
    };
    const gwFallback = new BedrockBatchLlmGateway(jobs, storage, onDemand, REFS, {
      minimoRegistrosPorJob: 5, // 1 entrada < 5 → fallback on-demand
      sleep: nosleep,
    });
    const [resFallback] = await gwFallback.extrairLote([a], noop);

    expect(resLote!.ok && resLote!.uso.transporte).toBe('lote');
    expect(resFallback!.ok && resFallback!.uso.transporte).toBe('on_demand');
    // Mesmo USO_FAKE (100 in / 50 out) nos dois transportes — só o transporte muda o custo.
    const custoLote = resLote!.ok ? calcularCustoUsd(resLote!.uso) : NaN;
    const custoFallback = resFallback!.ok ? calcularCustoUsd(resFallback!.uso) : NaN;
    expect(custoLote).toBeCloseTo(custoFallback * 0.5, 9);
  });

  it('RAD-341: uso.modelo grava o nome NU do tier (chave de preço), não o ID Bedrock cheio — job de lote e fallback on-demand', async () => {
    // "fácil" → tier síncrono claude-sonnet-5 → par batch resolvido anthropic.claude-sonnet-4-6-v1:0.
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')]);
    const gwLote = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
    });
    const [resLote] = await gwLote.extrairLote([a], noop);
    expect(resLote!.ok && resLote!.uso.modelo).toBe('claude-sonnet-4-6');

    const onDemand: BedrockInvokeClient = { invoke: async () => mensagem('Aquisição de notebooks') };
    const gwFallback = new BedrockBatchLlmGateway(jobs, storage, onDemand, REFS, {
      minimoRegistrosPorJob: 5, // 1 entrada < 5 → fallback on-demand
      sleep: nosleep,
    });
    const [resFallback] = await gwFallback.extrairLote([a], noop);
    expect(resFallback!.ok && resFallback!.uso.modelo).toBe('claude-sonnet-4-6');

    // Preço do tier REAL (Sonnet 4.6: $3/$15 por milhão) — NUNCA o fallback de Opus ($5/$25) que
    // `PRECO_DESCONHECIDO` aplicaria se `uso.modelo` chegasse como o ID Bedrock cheio (bug RAD-341).
    const custoEsperadoCheio = (100 / 1_000_000) * 3 + (50 / 1_000_000) * 15;
    const custoLote = resLote!.ok ? calcularCustoUsd(resLote!.uso) : NaN;
    const custoFallback = resFallback!.ok ? calcularCustoUsd(resFallback!.uso) : NaN;
    expect(custoFallback).toBeCloseTo(custoEsperadoCheio, 9);
    expect(custoLote).toBeCloseTo(custoEsperadoCheio * 0.5, 9);
  });

  it('RAD-341: ID Bedrock sem par de nome nu conhecido falha o item — nunca grava o ID cheio como uso.modelo', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const { jobs, storage } = fakeJob([linhaSucesso(recordIdOf(a), 'Aquisição de notebooks')]);
    const gw = new BedrockBatchLlmGateway(jobs, storage, semOnDemand, REFS, {
      minimoRegistrosPorJob: 1,
      sleep: nosleep,
      resolverModeloBatch: () => 'anthropic.claude-desconhecido-v9:0',
    });
    const [res] = await gw.extrairLote([a], noop);
    expect(res!.ok).toBe(false);
    expect(res!.ok === false && res!.motivo).toMatch(/sem nome nu conhecido/);
  });

  it('fallback on-demand: saída fora do schema vira falha do item, sem derrubar o lote', async () => {
    const a = entrada('A', 'Objeto: aquisição de notebooks.');
    const b = entrada('B', 'Objeto: contratação de limpeza.');
    const jobs: BedrockBatchJobClient = {
      create: async () => ({ jobArn: 'x' }),
      retrieve: async () => ({ status: 'Completed' }),
    };
    const storage: BedrockBatchStorageClient = { put: async () => {}, get: async () => '' };
    const invalido = toolInput('x') as { objeto: { confianca: number } };
    invalido.objeto.confianca = 2; // fora de [0,1]
    const onDemand: BedrockInvokeClient = {
      invoke: async (req) =>
        req.userContent.includes('limpeza') ? mensagem('x', invalido) : mensagem('Aquisição de notebooks'),
    };

    const gw = new BedrockBatchLlmGateway(jobs, storage, onDemand, REFS, {
      minimoRegistrosPorJob: 5,
      sleep: nosleep,
    });
    const res = await gw.extrairLote([a, b], noop);

    expect(res.find((r) => r.editalId === a.editalId)).toMatchObject({ ok: true });
    expect(res.find((r) => r.editalId === b.editalId)).toMatchObject({ ok: false });
  });
});

/** Espelha `recordIdDoEdital` (não exportado) para montar as saídas fake nos testes. */
function recordIdOf(entrada: EntradaExtracaoDTO): string {
  return String(entrada.editalId).replace(/[^0-9a-zA-Z]/g, '');
}
