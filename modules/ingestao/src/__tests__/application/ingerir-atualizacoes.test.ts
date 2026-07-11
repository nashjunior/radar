import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { IngerirAtualizacoesUseCase } from '../../application/use-cases/ingerir-atualizacoes.js';
import { FonteIndisponivelError, SchemaDriftError } from '../../domain/errors/index.js';
import type {
  ContratacaoData,
  EditalRepository,
  EventPublisher,
  IdProvider,
  PncpGateway,
  ProvenienciaRepository,
} from '../../application/ports.js';

const CNPJ_VALIDO = '11222333000181';
const noop = new AbortController().signal;

function contratacaoBase(override?: Partial<ContratacaoData>): ContratacaoData {
  return {
    numeroControlePncp: '00394502000167-1-000001/2024',
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Serviços de TI',
    valorEstimado: 100000,
    prazoProposta: new Date('2024-03-15T23:59:00Z'),
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
    ...override,
  };
}

async function* paginaUnica(paginas: ContratacaoData[][]): AsyncGenerator<ContratacaoData[]> {
  for (const p of paginas) yield p;
}

function criarDeps(overrides?: {
  contratacoes?: ContratacaoData[][];
  existente?: { id: EditalId; faseAtual: string } | null;
}) {
  const { contratacoes = [[contratacaoBase()]], existente = null } = overrides ?? {};

  const gateway: PncpGateway = {
    buscarContratacoesPorPublicacao: vi.fn(),
    buscarContratacoesPorAtualizacao: vi.fn().mockReturnValue(paginaUnica(contratacoes)),
    buscarContratacaoPorNumero: vi.fn(),
    buscarArquivos: vi.fn(),
    downloadArquivo: vi.fn(),
  };

  const editais: EditalRepository = {
    upsertPorNumeroControle: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    porNumeroControle: vi.fn().mockResolvedValue(existente),
    listarPorJanelaPublicacao: vi.fn(),
  };

  const proveniencias: ProvenienciaRepository = {
    registrar: vi.fn().mockResolvedValue(undefined),
  };

  const eventos: EventPublisher = {
    publicar: vi.fn().mockResolvedValue(undefined),
  };

  const ids: IdProvider = {
    gerar: vi.fn().mockReturnValue(EditalId('novo-edital-001')),
  };

  return { gateway, editais, proveniencias, eventos, ids };
}

const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };

describe('IngerirAtualizacoesUseCase', () => {
  describe('caminho feliz — novo edital', () => {
    it('persiste o edital, registra proveniência e publica edital.ingerido', async () => {
      const deps = criarDeps();
      const uc = new IngerirAtualizacoesUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const res = await uc.executar({ janela }, noop);

      expect(deps.editais.upsertPorNumeroControle).toHaveBeenCalledOnce();
      expect(deps.proveniencias.registrar).toHaveBeenCalledOnce();
      expect(res.ingeridos).toBe(1);
      expect(res.atualizados).toBe(0);
    });
  });

  describe('fase mudou — edital já existente', () => {
    it('publica edital.fase-mudou e conta atualizados=1', async () => {
      const deps = criarDeps({
        existente: { id: EditalId('existente-001'), faseAtual: 'Publicado' },
        contratacoes: [[contratacaoBase({ faseAtual: 'Homologado' })]],
      });
      const uc = new IngerirAtualizacoesUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const res = await uc.executar({ janela }, noop);

      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
      expect(res.atualizados).toBe(1);
      expect(res.ingeridos).toBe(0);
    });
  });

  describe('erros fatais — propagam e interrompem o lote', () => {
    it('relança FonteIndisponivelError sem incrementar erros', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn().mockReturnValue(gen()),
        buscarContratacaoPorNumero: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const editais: EditalRepository = {
        upsertPorNumeroControle: vi.fn().mockRejectedValue(new FonteIndisponivelError('PNCP')),
        porId: vi.fn(),
        porNumeroControle: vi.fn().mockResolvedValue(null),
        listarPorJanelaPublicacao: vi.fn(),
      };

      const uc = new IngerirAtualizacoesUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      await expect(uc.executar({ janela }, noop)).rejects.toThrow(FonteIndisponivelError);
    });

    it('relança SchemaDriftError', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn().mockReturnValue(gen()),
        buscarContratacaoPorNumero: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const editais: EditalRepository = {
        upsertPorNumeroControle: vi.fn().mockRejectedValue(new SchemaDriftError('campo', 'drift')),
        porId: vi.fn(),
        porNumeroControle: vi.fn().mockResolvedValue(null),
        listarPorJanelaPublicacao: vi.fn(),
      };

      const uc = new IngerirAtualizacoesUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      await expect(uc.executar({ janela }, noop)).rejects.toThrow(SchemaDriftError);
    });
  });

  describe('erros não-fatais — contados e não relançados', () => {
    it('incrementa erros e não lança para erros genéricos', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn().mockReturnValue(gen()),
        buscarContratacaoPorNumero: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const editais: EditalRepository = {
        upsertPorNumeroControle: vi.fn().mockRejectedValue(new Error('falha temporária')),
        porId: vi.fn(),
        porNumeroControle: vi.fn().mockResolvedValue(null),
        listarPorJanelaPublicacao: vi.fn(),
      };

      const uc = new IngerirAtualizacoesUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      const res = await uc.executar({ janela }, noop);
      expect(res.erros).toBe(1);
      expect(res.ingeridos).toBe(0);
    });
  });

  describe('AbortSignal', () => {
    it('propaga o signal para o gateway', async () => {
      const deps = criarDeps();
      const uc = new IngerirAtualizacoesUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const ac = new AbortController();
      await uc.executar({ janela }, ac.signal);

      expect(deps.gateway.buscarContratacoesPorAtualizacao).toHaveBeenCalledWith(janela, ac.signal);
    });

    it('relança erro sem contar em erros quando o signal já foi abortado (RAD-188/189)', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn().mockReturnValue(gen()),
        buscarContratacaoPorNumero: vi.fn(),
        buscarArquivos: vi.fn(),
        downloadArquivo: vi.fn(),
      };
      const ac = new AbortController();
      const editais: EditalRepository = {
        upsertPorNumeroControle: vi.fn().mockImplementation(() => {
          ac.abort();
          return Promise.reject(new DOMException('aborted', 'AbortError'));
        }),
        porId: vi.fn(),
        porNumeroControle: vi.fn().mockResolvedValue(null),
        listarPorJanelaPublicacao: vi.fn(),
      };

      const uc = new IngerirAtualizacoesUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      await expect(uc.executar({ janela }, ac.signal)).rejects.toThrow();
    });
  });
});
