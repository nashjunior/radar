import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, AlertaId, ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { AlertaNaoEncontradoError } from '../../domain/errors/index.js';
import { RegistrarFeedbackAlertaUseCase } from '../../application/use-cases/registrar-feedback-alerta.js';
import type { AlertaRepository, EventPublisher } from '../../application/ports.js';

function criarAlerta(clienteFinalId: string): Alerta {
  return Alerta.criar({
    id: AlertaId('alerta-001'),
    tenantId: TenantId('tenant-a'),
    clienteFinalId: ClienteFinalId(clienteFinalId),
    criterioId: CriterioId('crit-001'),
    editalId: 'edital-001' as any,
    aderencia: AderenciaMatching.criar(0.8),
  });
}

const noop = new AbortController().signal;

describe('RegistrarFeedbackAlertaUseCase', () => {
  /**
   * TC-AB1 (A07 §2.1 / A16 §5): verificação de autorização por objeto.
   * Nenhum alerta de outro clienteFinal deve ser acessível ou mutável.
   */
  describe('TC-AB1 — autorização por objeto (IDOR/cross-tenant)', () => {
    it('lança AcessoNegadoError quando clienteFinalId diverge do dono do alerta', async () => {
      const alerta = criarAlerta('cliente-A');
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback: vi.fn(),
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };

      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      await expect(
        uc.executar(
          { alertaId: AlertaId('alerta-001'), relevante: true, clienteFinalId: ClienteFinalId('cliente-B') },
          noop,
        ),
      ).rejects.toThrow(AcessoNegadoError);
    });

    it('o erro de acesso negado tem code ACESSO_NEGADO', async () => {
      const alerta = criarAlerta('cliente-A');
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback: vi.fn(),
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };
      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      try {
        await uc.executar({ alertaId: AlertaId('alerta-001'), relevante: true, clienteFinalId: ClienteFinalId('cliente-B') }, noop);
      } catch (e) {
        expect((e as AcessoNegadoError).code).toBe('ACESSO_NEGADO');
      }
    });

    it('não chama atualizarFeedback quando clienteFinalId diverge (nenhuma mutação)', async () => {
      const alerta = criarAlerta('cliente-A');
      const atualizarFeedback = vi.fn();
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback,
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };
      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      await uc.executar({ alertaId: AlertaId('alerta-001'), relevante: true, clienteFinalId: ClienteFinalId('cliente-B') }, noop).catch(() => {});

      expect(atualizarFeedback).not.toHaveBeenCalled();
    });

    it('não publica evento quando clienteFinalId diverge', async () => {
      const alerta = criarAlerta('cliente-A');
      const publicar = vi.fn();
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback: vi.fn(),
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar };
      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      await uc.executar({ alertaId: AlertaId('alerta-001'), relevante: true, clienteFinalId: ClienteFinalId('cliente-B') }, noop).catch(() => {});

      expect(publicar).not.toHaveBeenCalled();
    });
  });

  describe('caminho feliz', () => {
    it('registra feedback e persiste quando clienteFinalId é o dono', async () => {
      const alerta = criarAlerta('cliente-A');
      const atualizarFeedback = vi.fn().mockResolvedValue(undefined);
      const publicar = vi.fn().mockResolvedValue(undefined);
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback,
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar };
      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      await uc.executar({ alertaId: AlertaId('alerta-001'), relevante: false, clienteFinalId: ClienteFinalId('cliente-A') }, noop);

      expect(atualizarFeedback).toHaveBeenCalledWith(alerta.id, false, noop);
      expect(publicar).toHaveBeenCalledOnce();
    });

    it('lança AlertaNaoEncontradoError quando alerta não existe', async () => {
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(null),
        atualizarFeedback: vi.fn(),
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar: vi.fn() };
      const uc = new RegistrarFeedbackAlertaUseCase(alertas, eventos);

      await expect(
        uc.executar({ alertaId: AlertaId('inexistente'), relevante: true, clienteFinalId: ClienteFinalId('cliente-A') }, noop),
      ).rejects.toThrow(AlertaNaoEncontradoError);
    });
  });
});
