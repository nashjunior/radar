import { describe, expect, it, vi } from 'vitest';
import { ReconciliarPrazoCriticoUseCase } from '../../application/use-cases/reconciliar-prazo-critico.js';
import type { ClockProvider, CoberturaPrazoCriticoRepository, EventPublisher } from '../../application/ports.js';

const noop = new AbortController().signal;
const AGORA = new Date('2026-07-12T00:00:00.000Z');

function mockClock(): ClockProvider {
  return { agora: () => AGORA };
}

function mockCobertura(resultado: { elegivel: number; coberto: number }): CoberturaPrazoCriticoRepository {
  return { contar: vi.fn().mockResolvedValue(resultado) };
}

function mockEventPublisher(): EventPublisher {
  return { publicar: vi.fn().mockResolvedValue(undefined) };
}

describe('ReconciliarPrazoCriticoUseCase', () => {
  it('perdido = 0 quando todo edital elegível tem cobertura completa', async () => {
    const cobertura = mockCobertura({ elegivel: 5, coberto: 5 });
    const eventos = mockEventPublisher();
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, eventos, mockClock());

    const resultado = await uc.executar({}, noop);

    expect(resultado).toEqual({ elegivel: 5, coberto: 5, perdido: 0 });
  });

  it('acha o que não aconteceu: alerta de prazo crítico suprimido (fixture) faz perdido = 1', async () => {
    // Fixture: 1 edital elegível (prazo crítico, casado com critério) sem cobertura —
    // simula o alerta.gerado que deveria ter sido publicado e não foi.
    const cobertura = mockCobertura({ elegivel: 1, coberto: 0 });
    const eventos = mockEventPublisher();
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, eventos, mockClock());

    const resultado = await uc.executar({}, noop);

    expect(resultado.perdido).toBe(1);
  });

  it('publica AlertaPrazoCriticoReconciliado com elegivel/coberto/perdido', async () => {
    const cobertura = mockCobertura({ elegivel: 3, coberto: 1 });
    const eventos = mockEventPublisher();
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, eventos, mockClock());

    await uc.executar({}, noop);

    expect(eventos.publicar).toHaveBeenCalledOnce();
    const [evento] = (eventos.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { type: string; payload: { elegivel: number; coberto: number; perdido: number } },
    ];
    expect(evento.type).toBe('alerta.prazo-critico.reconciliado');
    expect(evento.payload).toEqual({ elegivel: 3, coberto: 1, perdido: 2 });
  });

  it('usa o limiar default de 3 dias (P-81) quando não informado', async () => {
    const cobertura = mockCobertura({ elegivel: 0, coberto: 0 });
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, mockEventPublisher(), mockClock());

    await uc.executar({}, noop);

    expect(cobertura.contar).toHaveBeenCalledWith({ agora: AGORA, diasLimiar: 3 }, noop);
  });

  it('respeita um diasLimiar customizado', async () => {
    const cobertura = mockCobertura({ elegivel: 0, coberto: 0 });
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, mockEventPublisher(), mockClock());

    await uc.executar({ diasLimiar: 7 }, noop);

    expect(cobertura.contar).toHaveBeenCalledWith({ agora: AGORA, diasLimiar: 7 }, noop);
  });

  it('propaga AbortSignal (P-78)', async () => {
    const ac = new AbortController();
    const cobertura = mockCobertura({ elegivel: 0, coberto: 0 });
    const uc = new ReconciliarPrazoCriticoUseCase(cobertura, mockEventPublisher(), mockClock());

    await uc.executar({}, ac.signal);

    const [, signal] = (cobertura.contar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, AbortSignal];
    expect(signal).toBe(ac.signal);
  });
});
