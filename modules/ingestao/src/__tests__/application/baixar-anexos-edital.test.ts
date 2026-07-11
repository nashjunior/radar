import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';
import { AnexoIndisponivelError, EditalNaoEncontradoError } from '../../domain/errors/index.js';
import { AnexoQuarentenado } from '../../application/events.js';
import { Edital } from '../../domain/entities/edital.js';
import type {
  AnexoEditalRepository,
  AnexoMetadados,
  ArquivoPncpData,
  EditalRepository,
  EventPublisher,
  ObjectStorage,
  PncpGateway,
} from '../../application/ports.js';

const CNPJ_VALIDO = '11222333000181';
const EDITAL_ID = EditalId('edital-001');
const noop = new AbortController().signal;

function criarEdital(): Edital {
  return Edital.criar({
    id: EDITAL_ID,
    numeroControlePncp: '00394502000167-1-000001/2024',
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Serviços de TI',
    valorEstimado: null,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date() },
    itens: [],
  });
}

const arquivoBase: ArquivoPncpData = {
  nome: 'edital.pdf',
  urlOrigem: 'https://pncp.gov.br/editais/001.pdf',
  tamanhoBytes: 204800,
  tipoMime: 'application/pdf',
};

function criarAnexoRepo(): AnexoEditalRepository {
  return {
    listarPorEdital: vi.fn().mockResolvedValue([] as AnexoMetadados[]),
    salvar: vi.fn(),
    atualizarEstado: vi.fn(),
  };
}

function criarPublisher(): EventPublisher {
  return { publicar: vi.fn() };
}

describe('BaixarAnexosEditalUseCase', () => {
  describe('edital não encontrado', () => {
    it('lança EditalNaoEncontradoError', async () => {
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(null),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const uc = new BaixarAnexosEditalUseCase(
        {} as PncpGateway,
        editais,
        {} as ObjectStorage,
        criarAnexoRepo(),
        criarPublisher(),
      );

      await expect(uc.executar({ editalId: EDITAL_ID }, noop)).rejects.toThrow(EditalNaoEncontradoError);
    });
  });

  describe('nenhum arquivo disponível', () => {
    it('não salva nada nem emite eventos', async () => {
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([]),
        downloadArquivo: vi.fn(),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const anexoRepo = criarAnexoRepo();
      const publisher = criarPublisher();
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, {} as ObjectStorage, anexoRepo, publisher);

      await uc.executar({ editalId: EDITAL_ID }, noop);

      expect(anexoRepo.salvar).not.toHaveBeenCalled();
      expect(publisher.publicar).not.toHaveBeenCalled();
    });
  });

  describe('download bem-sucedido', () => {
    it('salva como pendente e emite AnexoQuarentenado (trust-gating AB14)', async () => {
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([arquivoBase]),
        downloadArquivo: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const storage: ObjectStorage = {
        armazenar: vi.fn().mockResolvedValue('editais/edital-001/anexos/edital.pdf'),
        obter: vi.fn(),
        deletar: vi.fn(),
      };
      const anexoRepo = criarAnexoRepo();
      const publisher = criarPublisher();
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, storage, anexoRepo, publisher);

      await uc.executar({ editalId: EDITAL_ID }, noop);

      const salvarCall = (anexoRepo.salvar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const [savedId, savedArquivos] = salvarCall as [string, Array<{ estadoConfianca: string; nome: string }>];
      expect(savedId).toBe(EDITAL_ID);
      expect(savedArquivos[0]!.estadoConfianca).toBe('pendente');
      expect(savedArquivos[0]!.nome).toBe('edital.pdf');

      const publicarCall = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const [evento] = publicarCall as [AnexoQuarentenado];
      expect(evento).toBeInstanceOf(AnexoQuarentenado);
      expect(evento.payload.editalId).toBe(EDITAL_ID);
      expect(evento.payload.nomeAnexo).toBe('edital.pdf');
    });
  });

  describe('falha de download', () => {
    it('relança como AnexoIndisponivelError', async () => {
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([arquivoBase]),
        downloadArquivo: vi.fn().mockRejectedValue(new Error('timeout')),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const uc = new BaixarAnexosEditalUseCase(
        gateway,
        editais,
        {} as ObjectStorage,
        criarAnexoRepo(),
        criarPublisher(),
      );

      await expect(uc.executar({ editalId: EDITAL_ID }, noop)).rejects.toThrow(AnexoIndisponivelError);
    });
  });
});
