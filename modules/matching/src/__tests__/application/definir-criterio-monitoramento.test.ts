import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { DefinirCriterioMonitoramentoUseCase } from '../../application/use-cases/definir-criterio-monitoramento.js';
import { CriterioInvalidoError } from '../../domain/errors/index.js';
import type {
  ClockProvider,
  CriterioIdProvider,
  CriterioRepository,
  EventPublisher,
  FaixaValorReferencia,
} from '../../application/ports.js';

const noop = new AbortController().signal;

const agora = new Date('2026-07-05');
const clock: ClockProvider = { agora: () => agora };

function criarDeps(overrides?: { faixas?: FaixaValorReferencia }) {
  const criterios: CriterioRepository = {
    salvar: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    listarAtivos: vi.fn(),
    casarComEdital: vi.fn(),
  };
  const faixasRef: FaixaValorReferencia = overrides?.faixas ?? {
    faixasVigentes: vi.fn().mockResolvedValue([]),
  };
  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  const ids: CriterioIdProvider = { gerar: vi.fn().mockReturnValue(CriterioId('crit-gerado')) };
  return { criterios, faixasRef, eventos, ids };
}

const inputBase = {
  tenantId: TenantId('tenant-a'),
  clienteFinalId: ClienteFinalId('cliente-001'),
  ramoCnae: '62.01',
};

describe('DefinirCriterioMonitoramentoUseCase', () => {
  describe('caminho feliz', () => {
    it('cria e salva critério com ramo CNAE', async () => {
      const deps = criarDeps();
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      const dto = await uc.executar(inputBase, noop);

      expect(dto.ramoCnae).toBe('62.01');
      expect(dto.ativo).toBe(true);
      expect(deps.criterios.salvar).toHaveBeenCalledOnce();
    });

    it('publica evento CriterioDefinido após salvar', async () => {
      const deps = criarDeps();
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      await uc.executar(inputBase, noop);

      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
    });

    it('retorna DTO com tenantId e clienteFinalId corretos', async () => {
      const deps = criarDeps();
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      const dto = await uc.executar(inputBase, noop);

      expect(dto.tenantId).toBe('tenant-a');
      expect(dto.clienteFinalId).toBe('cliente-001');
    });

    it('resolve faixaValor a partir da tabela de referência quando faixaValorCodigo informado', async () => {
      const faixasRef: FaixaValorReferencia = {
        faixasVigentes: vi.fn().mockResolvedValue([
          { codigo: 'PEQUENO', min: 0, max: 80_000, vigenteDe: agora, vigenteAte: null },
        ]),
      };
      const deps = criarDeps({ faixas: faixasRef });
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      const dto = await uc.executar({ ...inputBase, faixaValorCodigo: 'PEQUENO' }, noop);

      expect(dto.faixaValorMin).toBe(0);
      expect(dto.faixaValorMax).toBe(80_000);
    });

    it('normaliza palavras-chave quando informadas', async () => {
      const deps = criarDeps();
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      const dto = await uc.executar({ ...inputBase, palavrasChave: ['TI', '  Cloud  '] }, noop);

      expect(dto.palavrasChave).toEqual(['ti', 'cloud']);
    });
  });

  describe('erros', () => {
    it('lança CriterioInvalidoError para faixaValorCodigo desconhecida', async () => {
      const faixasRef: FaixaValorReferencia = {
        faixasVigentes: vi.fn().mockResolvedValue([]),
      };
      const deps = criarDeps({ faixas: faixasRef });
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      await expect(
        uc.executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop),
      ).rejects.toThrow(CriterioInvalidoError);
    });

    it('o erro tem code CRITERIO_INVALIDO para faixa desconhecida', async () => {
      const faixasRef: FaixaValorReferencia = {
        faixasVigentes: vi.fn().mockResolvedValue([]),
      };
      const deps = criarDeps({ faixas: faixasRef });
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      try {
        await uc.executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop);
      } catch (e) {
        expect((e as CriterioInvalidoError).code).toBe('CRITERIO_INVALIDO');
      }
    });

    it('não salva nem publica evento quando a validação falha', async () => {
      const faixasRef: FaixaValorReferencia = {
        faixasVigentes: vi.fn().mockResolvedValue([]),
      };
      const deps = criarDeps({ faixas: faixasRef });
      const uc = new DefinirCriterioMonitoramentoUseCase(
        deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock,
      );

      await uc.executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop).catch(() => {});

      expect(deps.criterios.salvar).not.toHaveBeenCalled();
      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });
  });
});
