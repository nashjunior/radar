import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditalId } from '@radar/kernel';
import { TriagemBatchWorker } from '../../infra/queue/triagem-batch-worker.js';
import type { EditalIngeridoMsg } from '../../infra/queue/triagem-batch-worker.js';
import type { DocumentosEditalGateway, DocumentosRef, ObjectStorage } from '../../application/ports.js';
import type { ExtrairEditaisEmLoteUseCase } from '../../application/use-cases/extrair-editais-lote.js';

const signal = new AbortController().signal;

function msg(id: string): EditalIngeridoMsg {
  return {
    editalId: id,
    objeto: 'Aquisição de notebooks',
    orgaoUf: 'SP',
    valorEstimado: 100_000,
    dataPublicacao: '2025-01-01T00:00:00.000Z',
    modalidadeCodigo: 6,
  };
}

function docsRef(editalId: EditalId, storageKeys: string[]): DocumentosRef {
  return {
    editalId,
    arquivos: storageKeys.map((k) => ({ nome: `${k}.pdf`, storageKey: k, tipoMime: 'application/pdf' })),
  };
}

function buildWorker(opts?: {
  tamanhoBatch?: number;
  janelaMs?: number;
  storageKeys?: string[];
  docsError?: Error;
}) {
  const extrairLoteUC = { executar: vi.fn().mockResolvedValue({ extraidos: 0, cacheHits: 0, ignorados: 0, insuficientes: 0, falhas: 0 }) } as unknown as ExtrairEditaisEmLoteUseCase;

  const documentosGateway: DocumentosEditalGateway = {
    obterRefs: vi.fn(async (editalId: EditalId) => {
      if (opts?.docsError) throw opts.docsError;
      return docsRef(editalId, opts?.storageKeys ?? ['key-1']);
    }),
  };

  const storage: ObjectStorage = {
    obterTextoAnexo: vi.fn().mockResolvedValue('texto do edital'),
  };

  const dlq = { encaminhar: vi.fn().mockResolvedValue(undefined) };

  const worker = new TriagemBatchWorker(extrairLoteUC, documentosGateway, storage, dlq, {
    tamanhoBatch: opts?.tamanhoBatch ?? 3,
    janelaMs: opts?.janelaMs ?? 60_000,
  });

  return { worker, extrairLoteUC, documentosGateway, storage, dlq };
}

describe('TriagemBatchWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('flush por tamanho: executa o use case quando o buffer atinge tamanhoBatch', async () => {
    const { worker, extrairLoteUC } = buildWorker({ tamanhoBatch: 2, storageKeys: ['k1'] });

    await worker.enfileirar(msg('e1'), signal);
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    await worker.enfileirar(msg('e2'), signal);
    expect(extrairLoteUC.executar).toHaveBeenCalledOnce();

    worker.teardown();
  });

  it('flush manual: drena o buffer antes do limite de tamanho', async () => {
    const { worker, extrairLoteUC } = buildWorker({ tamanhoBatch: 10, storageKeys: ['k1'] });

    await worker.enfileirar(msg('e1'), signal);
    await worker.enfileirar(msg('e2'), signal);
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    await worker.flush();
    expect(extrairLoteUC.executar).toHaveBeenCalledOnce();

    worker.teardown();
  });

  it('flush por tempo: dispara após janelaMs', async () => {
    const { worker, extrairLoteUC } = buildWorker({ tamanhoBatch: 10, janelaMs: 5_000, storageKeys: ['k1'] });

    await worker.enfileirar(msg('e1'), signal);
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(extrairLoteUC.executar).toHaveBeenCalledOnce();

    worker.teardown();
  });

  it('flush em buffer vazio é no-op', async () => {
    const { worker, extrairLoteUC } = buildWorker();
    await worker.flush();
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();
    worker.teardown();
  });

  it('edital sem documentos é ignorado silenciosamente', async () => {
    const { worker, extrairLoteUC } = buildWorker({ tamanhoBatch: 1, storageKeys: [] });

    await worker.enfileirar(msg('e1'), signal);
    // O use case não é chamado porque itens.length === 0
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    worker.teardown();
  });

  it('erro na hidratação encaminha para DLQ sem crashar o worker', async () => {
    const err = new Error('S3 timeout');
    const { worker, extrairLoteUC, dlq } = buildWorker({
      tamanhoBatch: 1,
      docsError: err,
    });

    await worker.enfileirar(msg('e1'), signal);

    expect(dlq.encaminhar).toHaveBeenCalledWith({ editalId: 'e1' }, err);
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    worker.teardown();
  });

  it('teardown cancela o timer sem flush', async () => {
    const { worker, extrairLoteUC } = buildWorker({ janelaMs: 5_000, storageKeys: ['k1'] });

    await worker.enfileirar(msg('e1'), signal);
    worker.teardown();

    await vi.runAllTimersAsync();
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();
  });
});
