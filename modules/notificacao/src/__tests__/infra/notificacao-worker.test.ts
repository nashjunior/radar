import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@radar/kernel';
import { NotificacaoWorker } from '../../infra/queue/notificacao-worker.js';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import type { NotificarAlertaUseCase } from '../../application/use-cases/notificar-alerta.js';

const MSG = {
  alertaId: 'alerta-001',
  tenantId: 'tenant-001',
  clienteFinalId: 'cliente-001',
};
const noop = new AbortController().signal;

class OutroDomainError extends DomainError {
  readonly code = 'OUTRO' as const;
  constructor() {
    super('outro erro de domínio');
  }
}

function makeUC(behavior: 'ok' | 'canal_indisponivel' | 'domain_error' | 'infra_error') {
  return {
    executar: behavior === 'ok'
      ? vi.fn().mockResolvedValue(undefined)
      : behavior === 'canal_indisponivel'
        ? vi.fn().mockRejectedValue(new CanalIndisponivelError('EMAIL'))
        : behavior === 'domain_error'
          ? vi.fn().mockRejectedValue(new OutroDomainError())
          : vi.fn().mockRejectedValue(new Error('DB connection lost')),
  } as unknown as NotificarAlertaUseCase;
}

function makeDlq() {
  return { encaminhar: vi.fn().mockResolvedValue(undefined) };
}

// A14 §9 — roteamento de erros do worker (NACK vs DLQ vs rethrow)
describe('NotificacaoWorker', () => {
  it('processa mensagem com sucesso e não envia para DLQ', async () => {
    const uc = makeUC('ok');
    const dlq = makeDlq();
    const worker = new NotificacaoWorker(uc, dlq);

    await worker.processar(MSG, noop);

    expect(uc.executar).toHaveBeenCalledOnce();
    expect(dlq.encaminhar).not.toHaveBeenCalled();
  });

  it('CanalIndisponivelError → relança (NACK para retry)', async () => {
    const worker = new NotificacaoWorker(makeUC('canal_indisponivel'), makeDlq());

    await expect(worker.processar(MSG, noop)).rejects.toThrow(CanalIndisponivelError);
  });

  it('CanalIndisponivelError → NÃO envia para DLQ', async () => {
    const dlq = makeDlq();
    const worker = new NotificacaoWorker(makeUC('canal_indisponivel'), dlq);

    await expect(worker.processar(MSG, noop)).rejects.toThrow();

    expect(dlq.encaminhar).not.toHaveBeenCalled();
  });

  it('DomainError (não-canal) → encaminha para DLQ sem relançar', async () => {
    const dlq = makeDlq();
    const worker = new NotificacaoWorker(makeUC('domain_error'), dlq);

    await worker.processar(MSG, noop);

    expect(dlq.encaminhar).toHaveBeenCalledOnce();
    const [msgArg, errArg] = dlq.encaminhar.mock.calls[0]! as [typeof MSG, unknown];
    expect(msgArg).toEqual(MSG);
    expect(errArg).toBeInstanceOf(OutroDomainError);
  });

  it('erro de infraestrutura (não-DomainError) → relança sem DLQ', async () => {
    const dlq = makeDlq();
    const worker = new NotificacaoWorker(makeUC('infra_error'), dlq);

    await expect(worker.processar(MSG, noop)).rejects.toThrow('DB connection lost');

    expect(dlq.encaminhar).not.toHaveBeenCalled();
  });

  it('propaga AbortSignal ao use case', async () => {
    const ac = new AbortController();
    const uc = makeUC('ok');
    const worker = new NotificacaoWorker(uc, makeDlq());

    await worker.processar(MSG, ac.signal);

    const [, signal] = (uc.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(signal).toBe(ac.signal);
  });
});
