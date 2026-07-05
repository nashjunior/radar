import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { ReconciliarCatalogoUseCase } from '../../application/use-cases/reconciliar-catalogo.js';
import { FonteIndisponivelError, SchemaDriftError } from '../../domain/errors/index.js';
import { Edital } from '../../domain/entities/edital.js';
import type {
  ContratacaoData,
  EditalRepository,
  EventPublisher,
  PncpGateway,
} from '../../application/ports.js';

const CNPJ_VALIDO = '11222333000181';
const NUMERO_CONTROLE = '00394502000167-1-000001/2024';
const noop = new AbortController().signal;
const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };

function criarEdital(fase = 'Publicado', dataAt = new Date('2024-01-10T10:00:00Z')): Edital {
  return Edital.criar({
    id: EditalId('edital-001'),
    numeroControlePncp: NUMERO_CONTROLE,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: fase,
    objeto: 'Serviços de TI',
    valorEstimado: null,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: dataAt,
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date() },
    itens: [],
  });
}

function dadoPncp(fase = 'Publicado', dataAt = new Date('2024-01-10T10:00:00Z')): ContratacaoData {
  return {
    numeroControlePncp: NUMERO_CONTROLE,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: fase,
    objeto: 'Serviços de TI',
    valorEstimado: null,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: dataAt,
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
  };
}

async function* paginaLocal(editais: Edital[]): AsyncGenerator<Edital[]> {
  yield editais;
}

describe('ReconciliarCatalogoUseCase', () => {
  describe('catálogo vazio', () => {
    it('retorna verificados=0 e reingeridos=0', async () => {
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
      };
      const uc = new ReconciliarCatalogoUseCase({} as PncpGateway, editais, { publicar: vi.fn() });

      const res = await uc.executar({ janela }, noop);
      expect(res.verificados).toBe(0);
      expect(res.reingeridos).toBe(0);
    });
  });

  describe('edital sem divergência', () => {
    it('não reingeere quando fase e dataAtualizacao coincidem', async () => {
      const dataAt = new Date('2024-01-10T10:00:00Z');
      const editalLocal = criarEdital('Publicado', dataAt);
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([editalLocal])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(dadoPncp('Publicado', dataAt)),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };
      const uc = new ReconciliarCatalogoUseCase(gateway, editais, eventos);

      const res = await uc.executar({ janela }, noop);
      expect(res.verificados).toBe(1);
      expect(res.reingeridos).toBe(0);
      expect(editais.upsertPorNumeroControle).not.toHaveBeenCalled();
      expect(eventos.publicar).not.toHaveBeenCalled();
    });
  });

  describe('edital com divergência de fase', () => {
    it('reingeere quando a fase mudou no PNCP', async () => {
      const dataAt = new Date('2024-01-10T10:00:00Z');
      const editalLocal = criarEdital('Publicado', dataAt);
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([editalLocal])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn().mockResolvedValue(undefined),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(dadoPncp('Homologado', dataAt)),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
      const uc = new ReconciliarCatalogoUseCase(gateway, editais, eventos);

      const res = await uc.executar({ janela }, noop);
      expect(res.reingeridos).toBe(1);
      expect(editais.upsertPorNumeroControle).toHaveBeenCalledOnce();
      expect(eventos.publicar).toHaveBeenCalledOnce();
    });
  });

  describe('PNCP retorna null para edital local', () => {
    it('pula o edital e não reingeere', async () => {
      const editalLocal = criarEdital();
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([editalLocal])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(null),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new ReconciliarCatalogoUseCase(gateway, editais, { publicar: vi.fn() });

      const res = await uc.executar({ janela }, noop);
      expect(res.verificados).toBe(1);
      expect(res.reingeridos).toBe(0);
      expect(editais.upsertPorNumeroControle).not.toHaveBeenCalled();
    });
  });

  describe('erros fatais — propagam e interrompem', () => {
    it('relança FonteIndisponivelError', async () => {
      const editalLocal = criarEdital();
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([editalLocal])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn().mockRejectedValue(new FonteIndisponivelError('PNCP')),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(
          dadoPncp('Homologado', new Date('2024-02-01'))
        ),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new ReconciliarCatalogoUseCase(gateway, editais, { publicar: vi.fn() });

      await expect(uc.executar({ janela }, noop)).rejects.toThrow(FonteIndisponivelError);
    });

    it('relança SchemaDriftError', async () => {
      const editalLocal = criarEdital();
      const editais: EditalRepository = {
        listarPorJanelaPublicacao: vi.fn().mockReturnValue(paginaLocal([editalLocal])),
        porId: vi.fn(),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn().mockRejectedValue(new SchemaDriftError('campo', 'drift')),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(
          dadoPncp('Homologado', new Date('2024-02-01'))
        ),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new ReconciliarCatalogoUseCase(gateway, editais, { publicar: vi.fn() });

      await expect(uc.executar({ janela }, noop)).rejects.toThrow(SchemaDriftError);
    });
  });
});
