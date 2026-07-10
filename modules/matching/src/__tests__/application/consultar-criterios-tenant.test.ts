import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { ConsultarCriteriosTenantUseCase } from '../../application/use-cases/consultar-criterios-tenant.js';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type { AuditCriterioPort, CriterioRepository } from '../../application/ports.js';

const noop = new AbortController().signal;
const TENANT = TenantId('tenant-a');

function criarCriterio(id = 'crit-001'): CriterioDeMonitoramento {
  return CriterioDeMonitoramento.criar({
    id: CriterioId(id),
    tenantId: TENANT,
    clienteFinalId: ClienteFinalId('cliente-001'),
    palavrasChave: PalavrasChave.criar(['ti']),
  });
}

function mockRepo(criterios: CriterioDeMonitoramento[] = []): CriterioRepository {
  return {
    salvar: vi.fn(),
    porId: vi.fn(),
    listarAtivos: vi.fn(),
    listarPorTenant: vi.fn().mockResolvedValue(criterios),
  };
}

function mockAudit(fail = false): AuditCriterioPort {
  return {
    registrar: fail
      ? vi.fn().mockRejectedValue(new Error('db down'))
      : vi.fn().mockResolvedValue(undefined),
  };
}

describe('ConsultarCriteriosTenantUseCase', () => {
  describe('caminho feliz', () => {
    it('retorna lista vazia quando não há critérios para o tenant', async () => {
      const repo = mockRepo([]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit());

      const dtos = await uc.executar({ tenantId: TENANT }, noop);

      expect(dtos).toHaveLength(0);
    });

    it('projeta critérios do domínio para CriterioDTO', async () => {
      const repo = mockRepo([criarCriterio()]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit());

      const dtos = await uc.executar({ tenantId: TENANT }, noop);

      expect(dtos).toHaveLength(1);
      expect(dtos[0]!.id).toBe('crit-001');
      expect(dtos[0]!.tenantId).toBe(TENANT);
      expect(dtos[0]!.ativo).toBe(true);
    });

    it('propaga tenantId ao repositório (P-51)', async () => {
      const outro = TenantId('tenant-b');
      const repo = mockRepo([]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit());

      await uc.executar({ tenantId: outro }, noop);

      expect(repo.listarPorTenant).toHaveBeenCalledWith(outro, noop);
    });

    it('propaga AbortSignal ao repositório (P-78)', async () => {
      const ac = new AbortController();
      const repo = mockRepo([]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit());

      await uc.executar({ tenantId: TENANT }, ac.signal);

      expect(repo.listarPorTenant).toHaveBeenCalledWith(TENANT, ac.signal);
    });

    it('registra auditoria de leitura antes de retornar dados (P-61, AB13)', async () => {
      const audit = mockAudit();
      const repo = mockRepo([criarCriterio()]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, audit);

      await uc.executar({ tenantId: TENANT }, noop);

      expect(audit.registrar).toHaveBeenCalledOnce();
      const [entrada] = (audit.registrar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(entrada.acao).toBe('LER');
      expect(entrada.escopo.tenantId).toBe(TENANT);
    });
  });

  describe('AB13 — auditoria de leitura fail-closed (docs/05 §9, P-61)', () => {
    it('lança AuditoriaIndisponivelError quando AuditCriterioPort falha', async () => {
      const repo = mockRepo([]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit(true));

      await expect(uc.executar({ tenantId: TENANT }, noop)).rejects.toThrow(AuditoriaIndisponivelError);
    });

    it('não consulta o repositório quando auditoria falha (fail-closed antes de expor dados)', async () => {
      const repo = mockRepo([]);
      const uc = new ConsultarCriteriosTenantUseCase(repo, mockAudit(true));

      await uc.executar({ tenantId: TENANT }, noop).catch(() => {});

      expect(repo.listarPorTenant).not.toHaveBeenCalled();
    });

    it('AuditoriaIndisponivelError tem code AUDITORIA_INDISPONIVEL', async () => {
      const uc = new ConsultarCriteriosTenantUseCase(mockRepo(), mockAudit(true));

      const err = await uc.executar({ tenantId: TENANT }, noop).catch(e => e);
      expect((err as AuditoriaIndisponivelError).code).toBe('AUDITORIA_INDISPONIVEL');
    });
  });
});
