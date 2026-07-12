import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@radar/kernel';
import { CobrancaWorker } from '../../infra/queue/cobranca-worker.js';
import { AssinaturaNaoEncontradaError } from '../../domain/errors/index.js';
import type { ConfirmarUsoUseCase } from '../../application/use-cases/confirmar-uso.js';
import type { LiberarReservaUseCase } from '../../application/use-cases/liberar-reserva.js';
import type { IniciarTrialUseCase } from '../../application/use-cases/iniciar-trial.js';

const MSG_CONCLUIDA = {
  tenantId: 'tenant-001',
  clienteFinalId: 'cliente-001',
  editalId: 'edital-001',
  perfilId: 'perfil-001',
};
const MSG_FALHOU = { tenantId: 'tenant-001' };
const MSG_PROVISIONADA = { tenantId: 'tenant-001' };
const noop = new AbortController().signal;

function makeConfirmarUsoUC(behavior: 'ok' | 'domain_error' | 'infra_error') {
  return {
    executar:
      behavior === 'ok'
        ? vi.fn().mockResolvedValue(undefined)
        : behavior === 'domain_error'
          ? vi.fn().mockRejectedValue(new AssinaturaNaoEncontradaError('tenant-001' as never))
          : vi.fn().mockRejectedValue(new Error('DB connection lost')),
  } as unknown as ConfirmarUsoUseCase;
}

function makeLiberarReservaUC() {
  return { executar: vi.fn().mockResolvedValue(undefined) } as unknown as LiberarReservaUseCase;
}

function makeIniciarTrialUC() {
  return { executar: vi.fn().mockResolvedValue(undefined) } as unknown as IniciarTrialUseCase;
}

function makeDlq() {
  return { encaminhar: vi.fn().mockResolvedValue(undefined) };
}

describe('CobrancaWorker', () => {
  describe('processarTriagemConcluida', () => {
    it('processa com sucesso e não envia para DLQ', async () => {
      const uc = makeConfirmarUsoUC('ok');
      const dlq = makeDlq();
      const worker = new CobrancaWorker(uc, makeLiberarReservaUC(), dlq, makeIniciarTrialUC());

      await worker.processarTriagemConcluida(MSG_CONCLUIDA, noop);

      expect(uc.executar).toHaveBeenCalledOnce();
      expect(dlq.encaminhar).not.toHaveBeenCalled();
    });

    it('DomainError → encaminha para DLQ sem relançar', async () => {
      const dlq = makeDlq();
      const worker = new CobrancaWorker(makeConfirmarUsoUC('domain_error'), makeLiberarReservaUC(), dlq, makeIniciarTrialUC());

      await worker.processarTriagemConcluida(MSG_CONCLUIDA, noop);

      expect(dlq.encaminhar).toHaveBeenCalledOnce();
      const [msgArg, errArg] = dlq.encaminhar.mock.calls[0]! as [typeof MSG_CONCLUIDA, unknown];
      expect(msgArg).toEqual(MSG_CONCLUIDA);
      expect(errArg).toBeInstanceOf(DomainError);
    });

    it('erro de infraestrutura → relança sem DLQ (NACK, deixa o SQS reentregar)', async () => {
      const dlq = makeDlq();
      const worker = new CobrancaWorker(makeConfirmarUsoUC('infra_error'), makeLiberarReservaUC(), dlq, makeIniciarTrialUC());

      await expect(worker.processarTriagemConcluida(MSG_CONCLUIDA, noop)).rejects.toThrow('DB connection lost');
      expect(dlq.encaminhar).not.toHaveBeenCalled();
    });

    it('propaga AbortSignal ao use case', async () => {
      const ac = new AbortController();
      const uc = makeConfirmarUsoUC('ok');
      const worker = new CobrancaWorker(uc, makeLiberarReservaUC(), makeDlq(), makeIniciarTrialUC());

      await worker.processarTriagemConcluida(MSG_CONCLUIDA, ac.signal);

      const [, signal] = (uc.executar as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(signal).toBe(ac.signal);
    });
  });

  // DoD: triagem.falhou (incl. mensagem em DLQ, mesmo ponto de entrada) ⇒ libera a reserva.
  describe('processarTriagemFalhou', () => {
    it('chama LiberarReservaUseCase com o tenantId da mensagem', async () => {
      const liberarUC = makeLiberarReservaUC();
      const worker = new CobrancaWorker(makeConfirmarUsoUC('ok'), liberarUC, makeDlq(), makeIniciarTrialUC());

      await worker.processarTriagemFalhou(MSG_FALHOU, noop);

      expect(liberarUC.executar).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-001' }, noop);
    });

    it('é o mesmo caminho usado para reprocessar mensagem vinda da DLQ (idempotente, sem RegistroDeUso)', async () => {
      const liberarUC = makeLiberarReservaUC();
      const worker = new CobrancaWorker(makeConfirmarUsoUC('ok'), liberarUC, makeDlq(), makeIniciarTrialUC());

      await worker.processarTriagemFalhou(MSG_FALHOU, noop);
      await worker.processarTriagemFalhou(MSG_FALHOU, noop); // redrive da DLQ

      expect(liberarUC.executar).toHaveBeenCalledTimes(2);
    });
  });

  describe('processarOrganizacaoProvisionada', () => {
    it('chama IniciarTrialUseCase com o tenantId da mensagem (RAD-285)', async () => {
      const iniciarTrialUC = makeIniciarTrialUC();
      const worker = new CobrancaWorker(makeConfirmarUsoUC('ok'), makeLiberarReservaUC(), makeDlq(), iniciarTrialUC);

      await worker.processarOrganizacaoProvisionada(MSG_PROVISIONADA, noop);

      expect(iniciarTrialUC.executar).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-001' }, noop);
    });
  });
});
