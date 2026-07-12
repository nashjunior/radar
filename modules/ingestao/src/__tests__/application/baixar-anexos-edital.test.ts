import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';
import {
  AnexoIndisponivelError,
  EditalNaoEncontradoError,
} from '../../domain/errors/index.js';
import { AnexoFormatoNaoSuportadoError } from '../../domain/value-objects/extensao-anexo.js';
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
    anoCompra: 2024,
    sequencialCompra: 1,
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
  titulo: 'edital.pdf',
  urlOrigem: 'https://pncp.gov.br/editais/001.pdf',
  sequencialDocumento: 1,
  tipoDocumentoId: 2,
  tipoDocumentoNome: 'Edital',
  statusAtivo: true,
};

const baixadoBase = {
  conteudo: new Uint8Array([1, 2, 3]),
  tamanhoBytes: 204800,
  tipoMime: 'application/pdf',
  nomeArquivo: 'edital.pdf',
};

function criarAnexoRepo(): AnexoEditalRepository {
  return {
    listarPorEdital: vi.fn().mockResolvedValue([] as AnexoMetadados[]),
    salvar: vi.fn(),
    atualizarEstado: vi.fn(),
    atualizarTexto: vi.fn(),
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
        downloadArquivo: vi.fn().mockResolvedValue(baixadoBase),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const storage: ObjectStorage = {
        armazenar: vi.fn(async (chave: string) => chave),
        obter: vi.fn(),
        deletar: vi.fn(),
      };
      const anexoRepo = criarAnexoRepo();
      const publisher = criarPublisher();
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, storage, anexoRepo, publisher);

      await uc.executar({ editalId: EDITAL_ID }, noop);

      const salvarCall = (anexoRepo.salvar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const [savedId, savedArquivos] = salvarCall as [
        string,
        Array<{
          estadoConfianca: string;
          nome: string;
          sequencialDocumento: number;
          tipoDocumentoId: number;
          tipoDocumentoNome: string;
          textoKey: string;
          paginas: number;
        }>,
      ];
      expect(savedId).toBe(EDITAL_ID);
      expect(savedArquivos[0]!.estadoConfianca).toBe('pendente');
      expect(savedArquivos[0]!.nome).toBe('edital.pdf');
      expect(savedArquivos[0]!.sequencialDocumento).toBe(1);
      expect(savedArquivos[0]!.tipoDocumentoId).toBe(2);
      expect(savedArquivos[0]!.tipoDocumentoNome).toBe('Edital');
      // texto ainda não extraído neste ponto — só depois do scan aprovar (EscanearAnexoUseCase, P-104/AB14)
      expect(savedArquivos[0]!.paginas).toBe(0);
      expect(savedArquivos[0]!.textoKey).toBe('');

      const publicarCall = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
      const [evento] = publicarCall as [AnexoQuarentenado];
      expect(evento).toBeInstanceOf(AnexoQuarentenado);
      expect(evento.payload.editalId).toBe(EDITAL_ID);
      expect(evento.payload.nomeAnexo).toBe('edital.pdf');
      expect(evento.payload.sequencialDocumento).toBe(1);
    });
  });

  describe('chave de storage (RAD-278)', () => {
    it('não deriva a chave do título — título com path traversal não escapa do prefixo do edital', async () => {
      const arquivoMalicioso = {
        ...arquivoBase,
        titulo: '../../outro-edital/anexos/x',
        sequencialDocumento: 7,
      };
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([arquivoMalicioso]),
        downloadArquivo: vi.fn().mockResolvedValue(baixadoBase),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const storage: ObjectStorage = {
        armazenar: vi.fn().mockResolvedValue('storage-key-opaca'),
        obter: vi.fn(),
        deletar: vi.fn(),
      };
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, storage, criarAnexoRepo(), criarPublisher());

      await uc.executar({ editalId: EDITAL_ID }, noop);

      const [chave] = (storage.armazenar as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(chave).toBe(`editais/${EDITAL_ID}/anexos/7.pdf`);
      expect(chave.startsWith(`editais/${EDITAL_ID}/anexos/`)).toBe(true);
      expect(chave).not.toContain('..');
      expect(chave).not.toContain('outro-edital');
    });

    it('dois anexos com título duplicado geram chaves distintas (sequencialDocumento)', async () => {
      const arquivo1 = { ...arquivoBase, titulo: 'Edital', sequencialDocumento: 1 };
      const arquivo2 = { ...arquivoBase, titulo: 'Edital', sequencialDocumento: 2 };
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([arquivo1, arquivo2]),
        downloadArquivo: vi.fn().mockResolvedValue(baixadoBase),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      };
      const storage: ObjectStorage = {
        armazenar: vi.fn().mockResolvedValue('storage-key-opaca'),
        obter: vi.fn(),
        deletar: vi.fn(),
      };
      const anexoRepo = criarAnexoRepo();
      const uc = new BaixarAnexosEditalUseCase(gateway, editais, storage, anexoRepo, criarPublisher());

      await uc.executar({ editalId: EDITAL_ID }, noop);

      const chamadas = (storage.armazenar as ReturnType<typeof vi.fn>).mock.calls as [string][];
      const [chave1] = chamadas[0]!;
      const [chave2] = chamadas[1]!;
      expect(chave1).not.toBe(chave2);

      // RAD-291: identidade do registro de metadados também é sequencialDocumento —
      // dois `salvar()` distintos, um por sequencial, nenhum sobrescreve o outro.
      const salvarChamadas = (anexoRepo.salvar as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, Array<{ sequencialDocumento: number; nome: string }>]
      >;
      expect(salvarChamadas).toHaveLength(2);
      const sequenciaisSalvos = salvarChamadas.map(([, arquivos]) => arquivos[0]!.sequencialDocumento);
      expect(sequenciaisSalvos).toEqual([1, 2]);
    });

    it('rejeita mime fora da allowlist (não deriva extensão do título)', async () => {
      const editais: EditalRepository = {
        porId: vi.fn().mockResolvedValue(criarEdital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarArquivos: vi.fn().mockResolvedValue([arquivoBase]),
        downloadArquivo: vi.fn().mockResolvedValue({ ...baixadoBase, tipoMime: 'application/octet-stream' }),
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

      await expect(uc.executar({ editalId: EDITAL_ID }, noop)).rejects.toThrow(AnexoFormatoNaoSuportadoError);
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
