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
