import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { TriagemSolicitadaWorker } from '../../infra/queue/triagem-solicitada-worker.js';
import type { TriagemSolicitadaMsg } from '../../infra/queue/triagem-solicitada-worker.js';
import type { DocumentosEditalGateway, DocumentosRef, EventPublisher, ObjectStorage } from '../../application/ports.js';
import type { TriarEditalUseCase } from '../../application/use-cases/triar-edital.js';
import { AguardandoAnexoError, PerfilNaoEncontradoError } from '../../domain/errors/index.js';

const signal = new AbortController().signal;

const MSG: TriagemSolicitadaMsg = {
  tenantId: 'tenant-1',
  usuarioId: 'cliente-1',
  editalId: 'edital-1',
  perfilId: 'perfil-1',
  coorteTrial: false,
};

/**
 * Fixture padrão: o PRIMEIRO da lista é o Edital (tipoDocumentoId 2) — preserva o shape dos testes
 * legados que assumiam `arquivos[0]` como principal. `seleciona por tipo, não por posição` é coberto
 * à parte (`array fora de ordem, como o real`, P-110).
 */
function docsRef(editalId: ReturnType<typeof EditalId>, keys: string[]): DocumentosRef {
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
  storageKeys?: string[];
  docsError?: Error;
  triarExecutar?: ReturnType<typeof vi.fn>;
  docs?: DocumentosRef;
}) {
  const triarEditalUC = {
    executar: opts?.triarExecutar ?? vi.fn().mockResolvedValue({}),
  } as unknown as TriarEditalUseCase;

  const documentosGateway: DocumentosEditalGateway = {
    obterRefs: vi.fn(async (editalId) => {
      if (opts?.docsError) throw opts.docsError;
      return opts?.docs ?? docsRef(editalId, opts?.storageKeys ?? ['key-1']);
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
            paginas: 7, // paginas real do documento principal (RAD-280) — não mais hardcoded
          },
          anexosDisponiveis: true,
          coorteTrial: false,
        },
        signal,
      );
    });

    it('repassa coorteTrial: true da mensagem ao input do use case (RAD-271, bulkhead do coorte trial)', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: [] });

      await worker.processar({ ...MSG, coorteTrial: true }, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.coorteTrial).toBe(true);
    });

    it('repassa solicitadaEm do envelope de triagem.solicitada como Date ao input (A18 §5)', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: [] });

      await worker.processar({ ...MSG, solicitadaEm: '2026-07-10T12:00:00.000Z' }, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.solicitadaEm).toEqual(new Date('2026-07-10T12:00:00.000Z'));
    });

    it('sem solicitadaEm na mensagem (campo aditivo/opcional), input não carrega o campo', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: [] });

      await worker.processar(MSG, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.solicitadaEm).toBeUndefined();
    });

    it('edital sem documentos: hidrata com texto vazio e anexosDisponiveis: false (P-110/RAD-281 — TriarEditalUseCase decide o desfecho, não é falha de OCR)', async () => {
      const { worker, triarEditalUC } = buildWorker({ storageKeys: [] });

      await worker.processar(MSG, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.conteudo).toEqual({
        editalId: 'edital-1',
        texto: '',
        temTextoSelecionavel: false,
        anexos: [],
        paginas: 0, // sem documento principal, nº de páginas é desconhecido (não é mais piso de 1)
      });
      expect(input.anexosDisponiveis).toBe(false);
    });

    it('seleciona o principal por tipoDocumentoId mesmo com o Edital fora da posição 0 (array como o real, P-110)', async () => {
      const docs: DocumentosRef = {
        editalId: EditalId('edital-1'),
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
      const { worker, triarEditalUC } = buildWorker({ docs });

      await worker.processar(MSG, signal);

      const [input] = (triarEditalUC.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(input.conteudo).toEqual({
        editalId: 'edital-1',
        texto: 'texto-texto-key-edital',
        temTextoSelecionavel: true,
        anexos: ['texto-texto-key-parecer'],
        paginas: 9,
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

    it('AguardandoAnexoError (anexo ainda em quarentena) também é engolido — sem DLQ, sem falha (P-110/RAD-281)', async () => {
      const { worker } = buildWorker({
        storageKeys: [],
        triarExecutar: vi.fn().mockRejectedValue(new AguardandoAnexoError()),
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
