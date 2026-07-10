import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { AlertaNaoEncontradoError } from '../../domain/errors/index.js';
import { RegistrarAberturaAlertaUseCase } from '../../application/use-cases/registrar-abertura-alerta.js';
import type { AlertaRepository, EventPublisher } from '../../application/ports.js';

function criarAlerta(clienteFinalId: string): Alerta {
  return Alerta.criar({
    id: AlertaId('alerta-001'),
    tenantId: TenantId('tenant-a'),
    clienteFinalId: ClienteFinalId(clienteFinalId),
    criterioId: CriterioId('crit-001'),
    editalId: EditalId('edital-001'),
    aderencia: AderenciaMatching.criar(0.8),
  });
}

const noop = new AbortController().signal;

describe('RegistrarAberturaAlertaUseCase', () => {
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
      const uc = new RegistrarAberturaAlertaUseCase(alertas, eventos);

      await expect(
        uc.executar(
          { alertaId: AlertaId('alerta-001'), clienteFinalId: ClienteFinalId('cliente-B') },
          noop,
        ),
      ).rejects.toThrow(AcessoNegadoError);
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
      const uc = new RegistrarAberturaAlertaUseCase(alertas, eventos);

      await uc
        .executar(
          { alertaId: AlertaId('alerta-001'), clienteFinalId: ClienteFinalId('cliente-B') },
          noop,
        )
        .catch(() => {});

      expect(publicar).not.toHaveBeenCalled();
    });
  });

  describe('caminho feliz', () => {
    it('publica evento alerta.aberto quando dono abre o alerta', async () => {
      const alerta = criarAlerta('cliente-A');
      const publicar = vi.fn().mockResolvedValue(undefined);
      const alertas: AlertaRepository = {
        salvar: vi.fn(),
        salvarEmLote: vi.fn(),
        porId: vi.fn().mockResolvedValue(alerta),
        atualizarFeedback: vi.fn(),
        listarPorTenant: vi.fn(),
      };
      const eventos: EventPublisher = { publicar };
      const uc = new RegistrarAberturaAlertaUseCase(alertas, eventos);

      await uc.executar(
        { alertaId: AlertaId('alerta-001'), clienteFinalId: ClienteFinalId('cliente-A') },
        noop,
      );

      expect(publicar).toHaveBeenCalledOnce();
      const [evento] = publicar.mock.calls[0]!;
      expect(evento.type).toBe('alerta.aberto');
      expect(evento.payload.alertaId).toBe(alerta.id);
      expect(evento.payload.tenantId).toBe(alerta.tenantId);
      expect(evento.payload.clienteFinalId).toBe(alerta.clienteFinalId);
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
      const uc = new RegistrarAberturaAlertaUseCase(alertas, eventos);

      await expect(
        uc.executar(
          { alertaId: AlertaId('inexistente'), clienteFinalId: ClienteFinalId('cliente-A') },
          noop,
        ),
      ).rejects.toThrow(AlertaNaoEncontradoError);
    });
  });
});
