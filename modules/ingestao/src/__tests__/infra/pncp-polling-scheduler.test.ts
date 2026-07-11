import { describe, expect, it, vi } from 'vitest';
import { PncpPollingScheduler } from '../../infra/schedulers/pncp-polling-scheduler.js';
import type { IngerirEditaisUseCase } from '../../application/use-cases/ingerir-editais.js';

describe('PncpPollingScheduler', () => {
  it('executa o ciclo por modalidade com janela incremental e repassa AbortSignal', async () => {
    const signal = new AbortController().signal;
    const agora = new Date('2026-07-05T12:00:00.000Z');
    const executar = vi.fn().mockImplementation(async (input) => ({
      modalidade: input.modalidade,
      janela: {
        inicio: input.janela.inicio.toISOString(),
        fim: input.janela.fim.toISOString(),
      },
      ingeridos: 0,
      atualizados: 0,
      erros: 0,
    }));
    const scheduler = new PncpPollingScheduler(
      { executar } as Pick<IngerirEditaisUseCase, 'executar'>,
      {
        modalidades: [6, 8],
        intervaloMs: 30 * 60 * 1000,
        tamanhoJanelaMs: 30 * 60 * 1000,
        agora: () => agora,
      },
    );

    const resultados = await scheduler.executarCiclo(signal);

    expect(executar).toHaveBeenCalledTimes(2);
    expect(executar).toHaveBeenNthCalledWith(
      1,
      {
        modalidade: 6,
        janela: {
          inicio: new Date('2026-07-05T11:30:00.000Z'),
          fim: agora,
        },
      },
      signal,
    );
    expect(executar).toHaveBeenNthCalledWith(
      2,
      {
        modalidade: 8,
        janela: {
          inicio: new Date('2026-07-05T11:30:00.000Z'),
          fim: agora,
        },
      },
      signal,
    );
    expect(resultados).toHaveLength(2);
  });

  describe('guardrails de config', () => {
    const executar = vi.fn();
    const useCase = { executar } as Pick<IngerirEditaisUseCase, 'executar'>;
    const configValida = {
      modalidades: [6] as readonly number[],
      intervaloMs: 30_000,
      tamanhoJanelaMs: 30_000,
    };

    it('lanca RangeError se modalidades estiver vazio', () => {
      expect(
        () => new PncpPollingScheduler(useCase, { ...configValida, modalidades: [] }),
      ).toThrow(RangeError);
    });

    it('lanca RangeError se intervaloMs <= 0', () => {
      expect(
        () => new PncpPollingScheduler(useCase, { ...configValida, intervaloMs: 0 }),
      ).toThrow(RangeError);
      expect(
        () => new PncpPollingScheduler(useCase, { ...configValida, intervaloMs: -1 }),
      ).toThrow(RangeError);
    });

    it('lanca RangeError se tamanhoJanelaMs <= 0', () => {
      expect(
        () => new PncpPollingScheduler(useCase, { ...configValida, tamanhoJanelaMs: 0 }),
      ).toThrow(RangeError);
      expect(
        () => new PncpPollingScheduler(useCase, { ...configValida, tamanhoJanelaMs: -100 }),
      ).toThrow(RangeError);
    });

    it('constroi e executa um ciclo com config valida', async () => {
      const signal = new AbortController().signal;
      executar.mockResolvedValueOnce({
        modalidade: 6,
        janela: { inicio: '', fim: '' },
        ingeridos: 0,
        atualizados: 0,
        erros: 0,
      });
      const scheduler = new PncpPollingScheduler(useCase, {
        ...configValida,
        agora: () => new Date('2026-07-05T12:00:00.000Z'),
      });
      const resultados = await scheduler.executarCiclo(signal);
      expect(resultados).toHaveLength(1);
    });
  });

  describe('iniciar (ciclo de vida do abort)', () => {
    const dto = {
      modalidade: 6,
      janela: { inicio: '', fim: '' },
      ingeridos: 0,
      atualizados: 0,
      erros: 0,
    };
    const configBase = {
      modalidades: [6] as readonly number[],
      intervaloMs: 1_000,
      tamanhoJanelaMs: 1_000,
      agora: () => new Date('2026-07-05T12:00:00.000Z'),
    };

    it('para de agendar ciclos automaticamente quando o signal aborta', () => {
      vi.useFakeTimers();
      try {
        const ctrl = new AbortController();
        const executar = vi.fn().mockResolvedValue(dto);
        const scheduler = new PncpPollingScheduler(
          { executar } as Pick<IngerirEditaisUseCase, 'executar'>,
          configBase,
        );

        const parar = scheduler.iniciar(ctrl.signal);
        expect(executar).toHaveBeenCalledTimes(1); // tick imediato
        vi.advanceTimersByTime(1_000);
        expect(executar).toHaveBeenCalledTimes(2); // segundo tick

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
        const scheduler = new PncpPollingScheduler(
          { executar } as Pick<IngerirEditaisUseCase, 'executar'>,
          configBase,
        );

        const parar = scheduler.iniciar(ctrl.signal);
        vi.advanceTimersByTime(5_000);

        expect(executar).not.toHaveBeenCalled();
        expect(() => parar()).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('nao chama o use case quando o signal ja esta abortado', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const executar = vi.fn();
    const scheduler = new PncpPollingScheduler(
      { executar } as Pick<IngerirEditaisUseCase, 'executar'>,
      {
        modalidades: [6],
        intervaloMs: 30 * 60 * 1000,
        tamanhoJanelaMs: 30 * 60 * 1000,
        agora: () => new Date('2026-07-05T12:00:00.000Z'),
      },
    );

    expect(() => ctrl.signal.throwIfAborted()).toThrow();
    await expect(scheduler.executarCiclo(ctrl.signal)).rejects.toThrow();
    expect(executar).not.toHaveBeenCalled();
  });
});
