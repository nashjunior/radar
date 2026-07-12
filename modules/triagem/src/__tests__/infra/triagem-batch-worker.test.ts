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

/** Fixture padrão: o PRIMEIRO da lista é o Edital (tipoDocumentoId 2) — preserva o shape legado. */
function docsRef(editalId: EditalId, keys: string[]): DocumentosRef {
  return {
    editalId,
    arquivos: keys.map((k, i) => ({
      nome: `${k}.pdf`,
      storageKey: k,
      tipoMime: 'application/pdf',
      sequencialDocumento: i + 1,
      tipoDocumentoId: i === 0 ? 2 : 16,
      tipoDocumentoNome: i === 0 ? 'Edital' : 'Outros Documentos',
      textoKey: k,
      paginas: i === 0 ? 7 : 1,
    })),
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

  it('seleciona o principal por tipoDocumentoId mesmo com o Edital fora da posição 0 (array como o real, P-110)', async () => {
    const extrairLoteUC = {
      executar: vi.fn().mockResolvedValue({ extraidos: 0, cacheHits: 0, ignorados: 0, insuficientes: 0, falhas: 0 }),
    } as unknown as ExtrairEditaisEmLoteUseCase;
    const docs: DocumentosRef = {
      editalId: EditalId('e1'),
      arquivos: [
        {
          nome: 'parecer-contabil.pdf',
          storageKey: 'sk-parecer',
          tipoMime: 'application/pdf',
          sequencialDocumento: 1,
          tipoDocumentoId: 16,
          tipoDocumentoNome: 'Outros Documentos',
          textoKey: 'texto-key-parecer',
          paginas: 2,
        },
        {
          nome: 'edital.pdf',
          storageKey: 'sk-edital',
          tipoMime: 'application/pdf',
          sequencialDocumento: 2,
          tipoDocumentoId: 2,
          tipoDocumentoNome: 'Edital',
          textoKey: 'texto-key-edital',
          paginas: 9,
        },
      ],
    };
    const documentosGateway: DocumentosEditalGateway = { obterRefs: vi.fn().mockResolvedValue(docs) };
    const storage: ObjectStorage = {
      obterTextoAnexo: vi.fn(async (ref: string) => `texto-${ref}`),
    };
    const dlq = { encaminhar: vi.fn().mockResolvedValue(undefined) };
    const worker = new TriagemBatchWorker(extrairLoteUC, documentosGateway, storage, dlq, {
      tamanhoBatch: 1,
      janelaMs: 60_000,
    });

    await worker.enfileirar(msg('e1'), signal);

    const [itens] = (extrairLoteUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(itens).toEqual([
      {
        editalId: EditalId('e1'),
        texto: 'texto-texto-key-edital',
        temTextoSelecionavel: true,
        anexosRefs: ['texto-key-parecer'],
        paginas: 9,
      },
    ]);

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

  it('timer reinicia após flush por tamanho — itens posteriores recebem novo timer', async () => {
    const { worker, extrairLoteUC } = buildWorker({ tamanhoBatch: 2, janelaMs: 5_000, storageKeys: ['k1'] });

    // Primeiro lote: tamanho flush em e1+e2
    await worker.enfileirar(msg('e1'), signal);
    await worker.enfileirar(msg('e2'), signal);
    expect(extrairLoteUC.executar).toHaveBeenCalledOnce();

    // Terceiro item chega depois — novo timer deve ser agendado
    await worker.enfileirar(msg('e3'), signal);
    expect(extrairLoteUC.executar).toHaveBeenCalledOnce(); // ainda não disparou

    await vi.runAllTimersAsync();
    expect(extrairLoteUC.executar).toHaveBeenCalledTimes(2); // timer do e3 disparou

    worker.teardown();
  });

  it('use case lança exceção → flush() resolve sem crashar (worker resiliente)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const worker = new (await import('../../infra/queue/triagem-batch-worker.js')).TriagemBatchWorker(
      { executar: vi.fn().mockRejectedValue(new Error('lote falhou com cpf=123.456.789-00 senha=segredo')) } as any,
      { obterRefs: vi.fn(async (id: any) => docsRef(id, ['k1'])) },
      { obterTextoAnexo: vi.fn().mockResolvedValue('texto') },
      { encaminhar: vi.fn().mockResolvedValue(undefined) },
      { tamanhoBatch: 1, janelaMs: 60_000 },
    );

    await expect(worker.enfileirar(msg('e1'), signal)).resolves.toBeUndefined();

    const logado = JSON.stringify(consoleError.mock.calls);
    expect(logado).toContain('"tipo":"Error"');
    expect(logado).not.toContain('123.456.789-00');
    expect(logado).not.toContain('segredo');

    consoleError.mockRestore();
    worker.teardown();
  });

  it('todos os itens do lote falham na hidratação → DLQ chamado para cada um, use case não chamado', async () => {
    const err = new Error('gateway indisponível');
    const { worker, extrairLoteUC, dlq } = buildWorker({ tamanhoBatch: 2, docsError: err });

    await worker.enfileirar(msg('e1'), signal);
    await worker.enfileirar(msg('e2'), signal);

    expect(dlq.encaminhar).toHaveBeenCalledTimes(2);
    expect(dlq.encaminhar).toHaveBeenCalledWith({ editalId: 'e1' }, err);
    expect(dlq.encaminhar).toHaveBeenCalledWith({ editalId: 'e2' }, err);
    expect(extrairLoteUC.executar).not.toHaveBeenCalled();

    worker.teardown();
  });
});
