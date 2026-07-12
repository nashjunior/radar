import { describe, expect, it, vi } from 'vitest';
import { ReconciliadorPrazoCriticoScheduler } from '../../infra/schedulers/reconciliador-prazo-critico-scheduler.js';
import type { ReconciliarPrazoCriticoUseCase } from '../../application/use-cases/reconciliar-prazo-critico.js';

type UseCase = Pick<ReconciliarPrazoCriticoUseCase, 'executar'>;

const dto = { elegivel: 0, coberto: 0, perdido: 0 };

describe('ReconciliadorPrazoCriticoScheduler', () => {
  it('lanca RangeError se intervaloMs <= 0', () => {
    const executar = vi.fn();
    const useCase = { executar } as UseCase;

    expect(() => new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 0 })).toThrow(RangeError);
    expect(() => new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: -1 })).toThrow(RangeError);
  });

  it('lanca RangeError se intervaloMs nao for finito', () => {
    const executar = vi.fn();
    const useCase = { executar } as UseCase;

    expect(() => new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: NaN })).toThrow(RangeError);
    expect(() => new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: Infinity })).toThrow(RangeError);
  });

  it('executarCiclo chama o use case sem diasLimiar quando nao configurado', async () => {
    const signal = new AbortController().signal;
    const executar = vi.fn().mockResolvedValue(dto);
    const useCase = { executar } as UseCase;
    const scheduler = new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 1_000 });

    const resultado = await scheduler.executarCiclo(signal);

    expect(executar).toHaveBeenCalledWith({}, signal);
    expect(resultado).toEqual(dto);
  });

  it('executarCiclo repassa diasLimiar customizado', async () => {
    const signal = new AbortController().signal;
    const executar = vi.fn().mockResolvedValue(dto);
    const useCase = { executar } as UseCase;
    const scheduler = new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 1_000, diasLimiar: 7 });

    await scheduler.executarCiclo(signal);

    expect(executar).toHaveBeenCalledWith({ diasLimiar: 7 }, signal);
  });

  describe('iniciar (ciclo de vida do abort)', () => {
    it('roda 1x imediato e depois a cada intervaloMs, parando no abort', () => {
      vi.useFakeTimers();
      try {
        const ctrl = new AbortController();
        const executar = vi.fn().mockResolvedValue(dto);
        const useCase = { executar } as UseCase;
        const scheduler = new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 1_000 });

        const parar = scheduler.iniciar(ctrl.signal);
        expect(executar).toHaveBeenCalledTimes(1); // tick imediato
        vi.advanceTimersByTime(1_000);
        expect(executar).toHaveBeenCalledTimes(2);

        ctrl.abort();
        vi.advanceTimersByTime(5_000);
        expect(executar).toHaveBeenCalledTimes(2); // nao cresce apos abort

        expect(() => parar()).not.toThrow(); // idempotente
      } finally {
        vi.useRealTimers();
      }
    });

    it('nao agenda nada quando o signal ja esta abortado ao iniciar', () => {
      vi.useFakeTimers();
      try {
        const ctrl = new AbortController();
        ctrl.abort();
        const executar = vi.fn();
        const useCase = { executar } as UseCase;
        const scheduler = new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 1_000 });

        const parar = scheduler.iniciar(ctrl.signal);
        vi.advanceTimersByTime(5_000);

        expect(executar).not.toHaveBeenCalled();
        expect(() => parar()).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('encaminha o erro do ciclo para aoFalhar, sem derrubar o agendador', async () => {
    const ctrl = new AbortController();
    const erro = new Error('falha no contar()');
    const executar = vi.fn().mockRejectedValue(erro);
    const useCase = { executar } as UseCase;
    const aoFalhar = vi.fn();
    const scheduler = new ReconciliadorPrazoCriticoScheduler(useCase, { intervaloMs: 1_000, aoFalhar });

    const parar = scheduler.iniciar(ctrl.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(aoFalhar).toHaveBeenCalledWith(erro);
    parar();
  });
});
