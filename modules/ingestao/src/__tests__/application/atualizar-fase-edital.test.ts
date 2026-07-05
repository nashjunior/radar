import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { AtualizarFaseEditalUseCase } from '../../application/use-cases/atualizar-fase-edital.js';
import { EditalNaoEncontradoError, FonteIndisponivelError } from '../../domain/errors/index.js';
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

function criarEdital(fase = 'Publicado'): Edital {
  return Edital.criar({
    id: EditalId('edital-001'),
    numeroControlePncp: NUMERO_CONTROLE,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: fase,
    objeto: 'Serviços de TI',
    valorEstimado: 100000,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date() },
    itens: [],
  });
}

function dadoPncp(fase = 'Homologado'): ContratacaoData {
  return {
    numeroControlePncp: NUMERO_CONTROLE,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: fase,
    objeto: 'Serviços de TI',
    valorEstimado: 100000,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-02-01T00:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
  };
}

describe('AtualizarFaseEditalUseCase', () => {
  describe('edital não encontrado localmente', () => {
    it('lança EditalNaoEncontradoError', async () => {
      const editais: EditalRepository = {
        porNumeroControle: vi.fn().mockResolvedValue(null),
        porId: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn(),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new AtualizarFaseEditalUseCase(gateway, editais, { publicar: vi.fn() });

      await expect(
        uc.executar({ numeroControlePncp: NUMERO_CONTROLE }, noop),
      ).rejects.toThrow(EditalNaoEncontradoError);
    });
  });

  describe('PNCP não retorna dados', () => {
    it('lança FonteIndisponivelError', async () => {
      const editais: EditalRepository = {
        porNumeroControle: vi.fn().mockResolvedValue(criarEdital()),
        porId: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(null),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new AtualizarFaseEditalUseCase(gateway, editais, { publicar: vi.fn() });

      await expect(
        uc.executar({ numeroControlePncp: NUMERO_CONTROLE }, noop),
      ).rejects.toThrow(FonteIndisponivelError);
    });
  });

  describe('fase não mudou — sem upsert nem evento', () => {
    it('não persiste nem publica quando fase é igual', async () => {
      const editalLocal = criarEdital('Publicado');
      const editais: EditalRepository = {
        porNumeroControle: vi.fn().mockResolvedValue(editalLocal),
        porId: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(dadoPncp('Publicado')),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };
      const uc = new AtualizarFaseEditalUseCase(gateway, editais, eventos);

      await uc.executar({ numeroControlePncp: NUMERO_CONTROLE }, noop);

      expect(editais.upsertPorNumeroControle).not.toHaveBeenCalled();
      expect(eventos.publicar).not.toHaveBeenCalled();
    });
  });

  describe('fase mudou — persiste e publica EditalFaseMudou', () => {
    it('persiste o edital atualizado', async () => {
      const editais: EditalRepository = {
        porNumeroControle: vi.fn().mockResolvedValue(criarEdital('Publicado')),
        porId: vi.fn(),
        upsertPorNumeroControle: vi.fn().mockResolvedValue(undefined),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(dadoPncp('Homologado')),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
      const uc = new AtualizarFaseEditalUseCase(gateway, editais, eventos);

      await uc.executar({ numeroControlePncp: NUMERO_CONTROLE }, noop);

      expect(editais.upsertPorNumeroControle).toHaveBeenCalledOnce();
      expect(eventos.publicar).toHaveBeenCalledOnce();
    });

    it('retorna DTO com nova fase', async () => {
      const editais: EditalRepository = {
        porNumeroControle: vi.fn().mockResolvedValue(criarEdital('Publicado')),
        porId: vi.fn(),
        upsertPorNumeroControle: vi.fn().mockResolvedValue(undefined),
        listarPorJanelaPublicacao: vi.fn(),
      };
      const gateway: PncpGateway = {
        buscarContratacaoPorNumero: vi.fn().mockResolvedValue(dadoPncp('Homologado')),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const uc = new AtualizarFaseEditalUseCase(gateway, editais, { publicar: vi.fn().mockResolvedValue(undefined) });

      const dto = await uc.executar({ numeroControlePncp: NUMERO_CONTROLE }, noop);
      expect(dto.faseAtual).toBe('Homologado');
    });
  });
});
