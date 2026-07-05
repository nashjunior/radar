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
