import { describe, expect, it, vi } from 'vitest';
import { DomainError, EditalId } from '@radar/kernel';
import { MatchingWorker } from '../../infra/queue/matching-worker.js';
import type { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';
import type { EditalParaMatchingDTO } from '../../application/dtos.js';

const MSG_BASE = {
  editalId: 'edital-001',
  objeto: 'Serviços de TI',
  orgaoUf: 'SP',
  valorEstimado: 100000,
  dataPublicacao: '2024-01-10T10:00:00Z',
  modalidadeCodigo: 6,
};
const noop = new AbortController().signal;

class SomeDomainError extends DomainError {
  readonly code = 'SOME_DOMAIN_ERROR' as const;
  constructor() {
    super('erro de domínio');
  }
}

function makeUC(behavior: 'ok' | 'domain_error' | 'infra_error') {
  return {
    executar: behavior === 'ok'
      ? vi.fn().mockResolvedValue(undefined)
      : behavior === 'domain_error'
        ? vi.fn().mockRejectedValue(new SomeDomainError())
        : vi.fn().mockRejectedValue(new Error('DB down')),
  } as unknown as CasarEditalComCriteriosUseCase;
}

function makeDlq() {
  return { encaminhar: vi.fn().mockResolvedValue(undefined) };
}

// A14 §9 — MatchingWorker routing + mapeamento de mensagem
describe('MatchingWorker', () => {
  describe('happy path', () => {
    it('processa edital.ingerido e chama CasarEditalComCriteriosUseCase', async () => {
      const uc = makeUC('ok');
      const dlq = makeDlq();
      const worker = new MatchingWorker(uc, dlq);

      await worker.processar(MSG_BASE, noop);

      expect(uc.executar).toHaveBeenCalledOnce();
      expect(dlq.encaminhar).not.toHaveBeenCalled();
    });

    it('mapeia editalId para EditalId branded type', async () => {
      const uc = makeUC('ok');
      const worker = new MatchingWorker(uc, makeDlq());

      await worker.processar(MSG_BASE, noop);

      const [{ edital }] = vi.mocked(uc.executar).mock.calls[0]! as unknown as [{ edital: EditalParaMatchingDTO }];
      expect(edital.id).toBe(EditalId('edital-001'));
    });

    it('inclui proveniencia quando presente na mensagem (RAD-115)', async () => {
      const uc = makeUC('ok');
      const worker = new MatchingWorker(uc, makeDlq());
      const msgComProv = {
        ...MSG_BASE,
        proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', dataColeta: '2024-01-10' },
      };

      await worker.processar(msgComProv, noop);

      const [{ edital }] = vi.mocked(uc.executar).mock.calls[0]! as unknown as [{ edital: EditalParaMatchingDTO }];
      expect(edital.proveniencia).toEqual(msgComProv.proveniencia);
    });

    it('omite proveniencia quando ausente na mensagem (backward-compat)', async () => {
      const uc = makeUC('ok');
      const worker = new MatchingWorker(uc, makeDlq());

      await worker.processar(MSG_BASE, noop);

      const [{ edital }] = vi.mocked(uc.executar).mock.calls[0]! as unknown as [{ edital: EditalParaMatchingDTO }];
      expect('proveniencia' in edital).toBe(false);
    });
  });

  describe('roteamento de erros', () => {
    it('DomainError → encaminha para DLQ sem relançar', async () => {
      const dlq = makeDlq();
      const worker = new MatchingWorker(makeUC('domain_error'), dlq);

      await worker.processar(MSG_BASE, noop);

      expect(dlq.encaminhar).toHaveBeenCalledOnce();
      const [msgArg, errArg] = dlq.encaminhar.mock.calls[0]! as [unknown, unknown];
      expect(msgArg).toEqual({ editalId: MSG_BASE.editalId });
      expect(errArg).toBeInstanceOf(SomeDomainError);
    });

    it('erro de infra (não-DomainError) → relança para NACK', async () => {
      const dlq = makeDlq();
      const worker = new MatchingWorker(makeUC('infra_error'), dlq);

      await expect(worker.processar(MSG_BASE, noop)).rejects.toThrow('DB down');
      expect(dlq.encaminhar).not.toHaveBeenCalled();
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('propaga signal ao use case', async () => {
      const ac = new AbortController();
      const uc = makeUC('ok');
      const worker = new MatchingWorker(uc, makeDlq());

      await worker.processar(MSG_BASE, ac.signal);

      const [, signal] = vi.mocked(uc.executar).mock.calls[0]!;
      expect(signal).toBe(ac.signal);
    });
  });
});
