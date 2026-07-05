import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';
import { AnexoIndisponivelError, EditalNaoEncontradoError } from '../../domain/errors/index.js';
import { Edital } from '../../domain/entities/edital.js';
import type {
  ArquivoPncpData,
  EditalRepository,
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
      );

      await expect(uc.executar({ editalId: EDITAL_ID }, noop)).rejects.toThrow(EditalNaoEncontradoError);
    });
  });

  describe('nenhum arquivo disponível', () => {
    it('retorna lista vazia de arquivos', async () => {
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
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, {} as ObjectStorage);

      const dto = await uc.executar({ editalId: EDITAL_ID }, noop);
      expect(dto.arquivos).toHaveLength(0);
    });
  });

  describe('download bem-sucedido', () => {
    it('armazena arquivo e retorna metadados', async () => {
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
      };
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, storage);

      const dto = await uc.executar({ editalId: EDITAL_ID }, noop);

      expect(dto.editalId).toBe(EDITAL_ID);
      expect(dto.arquivos).toHaveLength(1);
      expect(dto.arquivos[0]!.nome).toBe('edital.pdf');
      expect(dto.arquivos[0]!.storageKey).toBe('editais/edital-001/anexos/edital.pdf');
      expect(storage.armazenar).toHaveBeenCalledOnce();
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
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, {} as ObjectStorage);

      await expect(uc.executar({ editalId: EDITAL_ID }, noop)).rejects.toThrow(AnexoIndisponivelError);
    });
  });
});
