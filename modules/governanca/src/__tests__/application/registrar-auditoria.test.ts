import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, TenantId } from '@radar/kernel';
import { RegistrarAuditoriaUseCase } from '../../application/use-cases/registrar-auditoria.js';
import type { RegistrarAuditoriaInput } from '../../application/use-cases/registrar-auditoria.js';
import type { AuditLogIdProvider, AuditLogRepository } from '../../application/ports.js';
import { AuditoriaBaseLegalInvalidaError, AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import { AuditLogId, RegistroAuditoria } from '../../domain/entities/registro-auditoria.js';

const noop = new AbortController().signal;
const AGORA = new Date('2026-07-06T00:00:00Z');

const TENANT = TenantId('tenant-1');
const CLIENTE = ClienteFinalId('cliente-1');

const INPUT: RegistrarAuditoriaInput = {
  usuarioId: 'usuario-1',
  recurso: 'triagem:edital-abc',
  acao: 'LER',
  baseLegal: 'LGPD art. 7 II',
  escopo: { tenantId: TENANT, clienteFinalId: CLIENTE },
};

function deps(overrides?: { registrar?: ReturnType<typeof vi.fn> }) {
  const registrar = overrides?.registrar ?? vi.fn().mockResolvedValue(undefined);
  const auditLog: AuditLogRepository = { registrar };
  const idProvider: AuditLogIdProvider = { gerar: vi.fn().mockReturnValue(AuditLogId('audit-001')) };
  const clock = { agora: () => AGORA };
  return { auditLog, idProvider, clock, registrar };
}

describe('RegistrarAuditoriaUseCase', () => {
  describe('caminho feliz', () => {
    it('persiste um RegistroAuditoria com os campos corretos', async () => {
      const { auditLog, idProvider, clock, registrar } = deps();
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      await uc.executar(INPUT, noop);

      expect(registrar).toHaveBeenCalledOnce();
      const [registro] = registrar.mock.calls[0]!;
      expect(registro).toBeInstanceOf(RegistroAuditoria);
      expect(registro.id).toBe('audit-001');
      expect(registro.usuarioId).toBe('usuario-1');
      expect(registro.recurso).toBe('triagem:edital-abc');
      expect(registro.acao).toBe('LER');
      expect(registro.baseLegal).toBe('LGPD art. 7 II');
      expect(registro.escopo.tenantId).toBe(TENANT);
      expect(registro.escopo.clienteFinalId).toBe(CLIENTE);
      expect(registro.ocorridoEm).toBe(AGORA);
    });

    it('aceita escopo sem clienteFinalId (operação de nível tenant)', async () => {
      const { auditLog, idProvider, clock, registrar } = deps();
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      await uc.executar({ ...INPUT, escopo: { tenantId: TENANT } }, noop);

      const [registro] = registrar.mock.calls[0]!;
      expect(registro.escopo.clienteFinalId).toBeUndefined();
    });
  });

  /**
   * AB13 — Integridade do audit log (arquitetura/07 §§2,5; P-61).
   * Se o repositório de auditoria falhar, a operação é bloqueada (fail-closed).
   * O caller recebe AuditoriaIndisponivelError e deve interromper a operação sensível.
   */
  describe('AB13 — fail-closed quando auditoria indisponível', () => {
    it('lança AuditoriaIndisponivelError quando AuditLogRepository falha', async () => {
      const registrar = vi.fn().mockRejectedValue(new Error('banco fora do ar'));
      const { auditLog, idProvider, clock } = deps({ registrar });
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      await expect(uc.executar(INPUT, noop)).rejects.toThrow(AuditoriaIndisponivelError);
    });

    it('AuditoriaIndisponivelError tem code AUDITORIA_INDISPONIVEL', async () => {
      const registrar = vi.fn().mockRejectedValue(new Error('timeout'));
      const { auditLog, idProvider, clock } = deps({ registrar });
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      try {
        await uc.executar(INPUT, noop);
      } catch (e) {
        expect((e as AuditoriaIndisponivelError).code).toBe('AUDITORIA_INDISPONIVEL');
      }
    });

    it('não propaga o erro original — encapsula como AuditoriaIndisponivelError (sem vazar infra)', async () => {
      const erroInterno = new Error('detalhe interno do banco');
      const registrar = vi.fn().mockRejectedValue(erroInterno);
      const { auditLog, idProvider, clock } = deps({ registrar });
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      const capturado = await uc.executar(INPUT, noop).catch(e => e);
      expect(capturado).toBeInstanceOf(AuditoriaIndisponivelError);
      expect(capturado).not.toBe(erroInterno);
    });
  });

  describe('baseLegal — validação de runtime (docs/05 §5/§8)', () => {
    it.each(['', '   '])('lança AuditoriaBaseLegalInvalidaError quando baseLegal é "%s"', async (baseLegal) => {
      const { auditLog, idProvider, clock } = deps();
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);

      await expect(uc.executar({ ...INPUT, baseLegal }, noop)).rejects.toThrow(AuditoriaBaseLegalInvalidaError);
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('propaga o signal ao AuditLogRepository', async () => {
      const registrar = vi.fn().mockResolvedValue(undefined);
      const { auditLog, idProvider, clock } = deps({ registrar });
      const uc = new RegistrarAuditoriaUseCase(auditLog, idProvider, clock);
      const controller = new AbortController();

      await uc.executar(INPUT, controller.signal);

      const [, signal] = registrar.mock.calls[0]!;
      expect(signal).toBe(controller.signal);
    });
  });
});
