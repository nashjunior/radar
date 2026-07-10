import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { DefinirCriterioMonitoramentoUseCase } from '../../application/use-cases/definir-criterio-monitoramento.js';
import { AuditoriaIndisponivelError, CriterioInvalidoError } from '../../domain/errors/index.js';
import type {
  AuditCriterioPort,
  ClockProvider,
  CriterioIdProvider,
  CriterioRepository,
  EventPublisher,
  FaixaValorReferencia,
} from '../../application/ports.js';

const noop = new AbortController().signal;

const agora = new Date('2026-07-05');
const clock: ClockProvider = { agora: () => agora };

function criarDeps(overrides?: { faixas?: FaixaValorReferencia; audit?: AuditCriterioPort }) {
  const criterios: CriterioRepository = {
    salvar: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    listarAtivos: vi.fn(),
    listarPorTenant: vi.fn(),
  };
  const faixasRef: FaixaValorReferencia = overrides?.faixas ?? {
    faixasVigentes: vi.fn().mockResolvedValue([]),
  };
  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  const ids: CriterioIdProvider = { gerar: vi.fn().mockReturnValue(CriterioId('crit-gerado')) };
  const audit: AuditCriterioPort = overrides?.audit ?? { registrar: vi.fn().mockResolvedValue(undefined) };
  return { criterios, faixasRef, eventos, ids, audit };
}

function criarUC(deps: ReturnType<typeof criarDeps>) {
  return new DefinirCriterioMonitoramentoUseCase(
    deps.criterios, deps.faixasRef, deps.eventos, deps.ids, clock, deps.audit,
  );
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
      const dto = await criarUC(deps).executar(inputBase, noop);

      expect(dto.ramoCnae).toBe('62.01');
      expect(dto.ativo).toBe(true);
      expect(deps.criterios.salvar).toHaveBeenCalledOnce();
    });

    it('registra auditoria de escrita após salvar (P-61, AB13)', async () => {
      const deps = criarDeps();
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.audit.registrar).toHaveBeenCalledOnce();
      const [entrada] = (deps.audit.registrar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(entrada.acao).toBe('ESCREVER');
      expect(entrada.escopo.tenantId).toBe('tenant-a');
      expect(entrada.escopo.clienteFinalId).toBe('cliente-001');
    });

    it('publica evento CriterioDefinido após auditoria bem-sucedida', async () => {
      const deps = criarDeps();
      await criarUC(deps).executar(inputBase, noop);

      expect(deps.eventos.publicar).toHaveBeenCalledOnce();
    });

    it('retorna DTO com tenantId e clienteFinalId corretos', async () => {
      const deps = criarDeps();
      const dto = await criarUC(deps).executar(inputBase, noop);

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
      const dto = await criarUC(deps).executar({ ...inputBase, faixaValorCodigo: 'PEQUENO' }, noop);

      expect(dto.faixaValorMin).toBe(0);
      expect(dto.faixaValorMax).toBe(80_000);
    });

    it('normaliza palavras-chave quando informadas', async () => {
      const deps = criarDeps();
      const dto = await criarUC(deps).executar({ ...inputBase, palavrasChave: ['TI', '  Cloud  '] }, noop);

      expect(dto.palavrasChave).toEqual(['ti', 'cloud']);
    });
  });

  describe('AB13 — auditoria fail-closed (docs/05 §9, P-61)', () => {
    it('lança AuditoriaIndisponivelError quando AuditCriterioPort falha', async () => {
      const audit: AuditCriterioPort = { registrar: vi.fn().mockRejectedValue(new Error('db down')) };
      const deps = criarDeps({ audit });

      await expect(criarUC(deps).executar(inputBase, noop)).rejects.toThrow(AuditoriaIndisponivelError);
    });

    it('não publica evento quando auditoria falha (operação bloqueada)', async () => {
      const audit: AuditCriterioPort = { registrar: vi.fn().mockRejectedValue(new Error('timeout')) };
      const deps = criarDeps({ audit });

      await criarUC(deps).executar(inputBase, noop).catch(() => {});

      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });

    it('AuditoriaIndisponivelError tem code AUDITORIA_INDISPONIVEL', async () => {
      const audit: AuditCriterioPort = { registrar: vi.fn().mockRejectedValue(new Error('falha')) };
      const deps = criarDeps({ audit });

      const err = await criarUC(deps).executar(inputBase, noop).catch(e => e);
      expect((err as AuditoriaIndisponivelError).code).toBe('AUDITORIA_INDISPONIVEL');
    });
  });

  describe('erros de validação', () => {
    it('lança CriterioInvalidoError para faixaValorCodigo desconhecida', async () => {
      const faixasRef: FaixaValorReferencia = {
        faixasVigentes: vi.fn().mockResolvedValue([]),
      };
      const deps = criarDeps({ faixas: faixasRef });

      await expect(
        criarUC(deps).executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop),
      ).rejects.toThrow(CriterioInvalidoError);
    });

    it('o erro tem code CRITERIO_INVALIDO para faixa desconhecida', async () => {
      const faixasRef: FaixaValorReferencia = { faixasVigentes: vi.fn().mockResolvedValue([]) };
      const deps = criarDeps({ faixas: faixasRef });

      const err = await criarUC(deps).executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop).catch(e => e);
      expect((err as CriterioInvalidoError).code).toBe('CRITERIO_INVALIDO');
    });

    it('não salva nem audita nem publica quando a validação falha', async () => {
      const faixasRef: FaixaValorReferencia = { faixasVigentes: vi.fn().mockResolvedValue([]) };
      const deps = criarDeps({ faixas: faixasRef });

      await criarUC(deps).executar({ ...inputBase, faixaValorCodigo: 'INVALIDO' }, noop).catch(() => {});

      expect(deps.criterios.salvar).not.toHaveBeenCalled();
      expect(deps.audit.registrar).not.toHaveBeenCalled();
      expect(deps.eventos.publicar).not.toHaveBeenCalled();
    });
  });
});
