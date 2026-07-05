import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { IngerirEditaisUseCase } from '../../application/use-cases/ingerir-editais.js';
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
  existente?: boolean;
  gatewayThrow?: Error;
}) {
  const { contratacoes = [[contratacaoBase()]], existente = false, gatewayThrow } = overrides ?? {};

  const gateway: PncpGateway = {
    buscarContratacoesPorPublicacao: gatewayThrow
      ? () => { throw gatewayThrow; }
      : vi.fn().mockReturnValue(paginaUnica(contratacoes)),
    buscarContratacoesPorAtualizacao: vi.fn(),
    buscarContratacaoPorNumero: vi.fn(),
    buscarArquivos: vi.fn(),
    downloadArquivo: vi.fn(),
  };

  const editais: EditalRepository = {
    upsertPorNumeroControle: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    porNumeroControle: vi.fn().mockResolvedValue(existente ? { id: EditalId('existente-001') } : null),
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

describe('IngerirEditaisUseCase', () => {
  describe('caminho feliz — novo edital', () => {
    it('persiste o edital, registra proveniência e publica evento', async () => {
      const deps = criarDeps();
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      await uc.executar({ modalidade: 6, janela }, noop);

      expect(deps.editais.upsertPorNumeroControle).toHaveBeenCalledOnce();
      expect(deps.proveniencias.registrar).toHaveBeenCalledOnce();
      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
    });

    it('retorna ingeridos=1 para um novo edital', async () => {
      const deps = criarDeps();
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const res = await uc.executar({ modalidade: 6, janela }, noop);
      expect(res.ingeridos).toBe(1);
      expect(res.atualizados).toBe(0);
    });
  });

  describe('idempotência — edital já existente', () => {
    it('usa o id do edital existente (não gera novo id)', async () => {
      const deps = criarDeps({ existente: true });
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      await uc.executar({ modalidade: 6, janela }, noop);

      expect(deps.ids.gerar).not.toHaveBeenCalled();
    });

    it('retorna atualizados=1 quando o edital já existe', async () => {
      const deps = criarDeps({ existente: true });
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const res = await uc.executar({ modalidade: 6, janela }, noop);
      expect(res.atualizados).toBe(1);
      expect(res.ingeridos).toBe(0);
    });
  });

  describe('múltiplas contratações em lote', () => {
    it('processa duas contratações — ingeridos=2', async () => {
      const dados = [
        contratacaoBase({ numeroControlePncp: 'NUM-001' }),
        contratacaoBase({ numeroControlePncp: 'NUM-002' }),
      ];
      const deps = criarDeps({ contratacoes: [dados] });
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const res = await uc.executar({ modalidade: 6, janela }, noop);
      expect(res.ingeridos).toBe(2);
      expect(deps.eventos.publicar).toHaveBeenCalledTimes(2);
    });
  });

  describe('erros fatais — propagam e interrompem o lote', () => {
    it('relança FonteIndisponivelError sem incrementar erros', async () => {
      const dado = contratacaoBase();
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [dado];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn().mockReturnValue(gen()),
        buscarContratacoesPorAtualizacao: vi.fn(),
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

      const uc = new IngerirEditaisUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      await expect(uc.executar({ modalidade: 6, janela }, noop)).rejects.toThrow(FonteIndisponivelError);
    });

    it('relança SchemaDriftError', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn().mockReturnValue(gen()),
        buscarContratacoesPorAtualizacao: vi.fn(),
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

      const uc = new IngerirEditaisUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      await expect(uc.executar({ modalidade: 6, janela }, noop)).rejects.toThrow(SchemaDriftError);
    });
  });

  describe('erros não-fatais — contados e não relançados', () => {
    it('incrementa erros e não lança para erros genéricos', async () => {
      async function* gen(): AsyncGenerator<ContratacaoData[]> {
        yield [contratacaoBase()];
      }
      const gateway: PncpGateway = {
        buscarContratacoesPorPublicacao: vi.fn().mockReturnValue(gen()),
        buscarContratacoesPorAtualizacao: vi.fn(),
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

      const uc = new IngerirEditaisUseCase(
        gateway,
        editais,
        { registrar: vi.fn() },
        { publicar: vi.fn() },
        { gerar: vi.fn().mockReturnValue(EditalId('id-001')) },
      );

      const res = await uc.executar({ modalidade: 6, janela }, noop);
      expect(res.erros).toBe(1);
      expect(res.ingeridos).toBe(0);
    });
  });

  describe('AbortSignal', () => {
    it('propaga o signal para o gateway', async () => {
      const deps = criarDeps();
      const uc = new IngerirEditaisUseCase(
        deps.gateway, deps.editais, deps.proveniencias, deps.eventos, deps.ids,
      );

      const ac = new AbortController();
      await uc.executar({ modalidade: 6, janela }, ac.signal);

      expect(deps.gateway.buscarContratacoesPorPublicacao).toHaveBeenCalledWith(
        6,
        janela,
        ac.signal,
      );
    });
  });
});
