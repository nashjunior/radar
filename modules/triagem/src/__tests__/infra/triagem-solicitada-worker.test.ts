import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { TriagemSolicitadaWorker } from '../../infra/queue/triagem-solicitada-worker.js';
import type { TriagemSolicitadaMsg } from '../../infra/queue/triagem-solicitada-worker.js';
import type { DocumentosEditalGateway, DocumentosRef, EventPublisher, ObjectStorage } from '../../application/ports.js';
import type { TriarEditalUseCase } from '../../application/use-cases/triar-edital.js';
import { PerfilNaoEncontradoError } from '../../domain/errors/index.js';

const signal = new AbortController().signal;

const MSG: TriagemSolicitadaMsg = {
  tenantId: 'tenant-1',
  usuarioId: 'cliente-1',
  editalId: 'edital-1',
  perfilId: 'perfil-1',
};

function docsRef(editalId: ReturnType<typeof EditalId>, storageKeys: string[]): DocumentosRef {
  return {
    editalId,
    arquivos: storageKeys.map((k) => ({ nome: `${k}.pdf`, storageKey: k, tipoMime: 'application/pdf' })),
  };
}

function buildWorker(opts?: {
  storageKeys?: string[];
  docsError?: Error;
  triarExecutar?: ReturnType<typeof vi.fn>;
}) {
  const triarEditalUC = {
    executar: opts?.triarExecutar ?? vi.fn().mockResolvedValue({}),
  } as unknown as TriarEditalUseCase;

  const documentosGateway: DocumentosEditalGateway = {
    obterRefs: vi.fn(async (editalId) => {
      if (opts?.docsError) throw opts.docsError;
      return docsRef(editalId, opts?.storageKeys ?? ['key-1']);
    }),
  };

  const storage: ObjectStorage = {
    obterTextoAnexo: vi.fn(async (ref: string) => `texto-${ref}`),
  };

  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  const dlq = { encaminhar: vi.fn().mockResolvedValue(undefined) };

  const worker = new TriagemSolicitadaWorker(triarEditalUC, documentosGateway, storage, eventos, dlq);

  return { worker, triarEditalUC, documentosGateway, storage, eventos, dlq };
}

describe('TriagemSolicitadaWorker', () => {
  describe('processar', () => {
    it('hidrata o conteúdo e chama TriarEditalUseCase com o input mapeado da mensagem', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: ['k1', 'k2', 'k3'] });

      await worker.processar(MSG, signal);

      expect(triarEditalUC.executar).toHaveBeenCalledExactlyOnceWith(
        {
          tenantId: 'tenant-1',
          clienteFinalId: 'cliente-1',
          perfilId: 'perfil-1',
          editalId: 'edital-1',
          conteudo: {
            editalId: 'edital-1',
            texto: 'texto-k1',
            temTextoSelecionavel: true,
            anexos: ['texto-k2', 'texto-k3'],
            paginas: 1,
          },
        },
        signal,
      );
    });

    it('edital sem documentos: hidrata com texto vazio (a política de conteúdo insuficiente é do use case)', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: [] });

      await worker.processar(MSG, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.conteudo).toEqual({
        editalId: 'edital-1',
        texto: '',
        temTextoSelecionavel: false,
        anexos: [],
        paginas: 1,
      });
    });

    it('erro na hidratação (infra) propaga sem chamar o use case — NACK para o transporte', async () => {
      const err = new Error('S3 indisponível');
      const { worker, triarEditalUC } = buildWorker({ docsError: err });

      await expect(worker.processar(MSG, signal)).rejects.toThrow('S3 indisponível');
      expect(triarEditalUC.executar).not.toHaveBeenCalled();
    });

    it('erro dentro de TriarEditalUseCase.executar é engolido — já compensado por triagem.falhou (RAD-255)', async () => {
      const { worker } = buildWorker({
        triarExecutar: vi.fn().mockRejectedValue(new PerfilNaoEncontradoError('perfil-1')),
      });

      await expect(worker.processar(MSG, signal)).resolves.toBeUndefined();
    });
  });

  describe('processarDlq', () => {
    it('publica triagem.falhou com a chave natural da mensagem ANTES de encaminhar para a DLQ', async () => {
      const err = new Error('crash antes de executar()');
      const { worker, eventos, dlq } = buildWorker();

      const ordem: string[] = [];
      (eventos.publicar as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        ordem.push('publicar');
      });
      dlq.encaminhar.mockImplementation(async () => {
        ordem.push('encaminhar');
      });

      await worker.processarDlq(MSG, err, signal);

      expect(eventos.publicar).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          type: 'triagem.falhou',
          payload: expect.objectContaining({
            tenantId: 'tenant-1',
            clienteFinalId: 'cliente-1',
            editalId: 'edital-1',
            perfilId: 'perfil-1',
            motivo: 'erro_inesperado',
          }),
        }),
        signal,
      );
      expect(dlq.encaminhar).toHaveBeenCalledExactlyOnceWith(MSG, err);
      expect(ordem).toEqual(['publicar', 'encaminhar']);
    });

    it('usa o code estável quando o erro é um DomainError', async () => {
      const err = new PerfilNaoEncontradoError('perfil-1');
      const { worker, eventos } = buildWorker();

      await worker.processarDlq(MSG, err, signal);

      expect(eventos.publicar).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ payload: expect.objectContaining({ motivo: 'PERFIL_NAO_ENCONTRADO' }) }),
        signal,
      );
    });
  });
});
