import { describe, expect, it, vi } from 'vitest';
import { WebhookPagamentoWorker } from '../../infra/queue/webhook-pagamento-worker.js';
import type { ProcessarEventoDePagamentoUseCase } from '../../application/use-cases/processar-evento-de-pagamento.js';
import type { ComandoPagamento } from '../../application/dtos.js';

const SIGNAL = new AbortController().signal;
const COMANDO: ComandoPagamento = { tipo: 'PagamentoConfirmado', eventoExternoId: 'evt-1', assinaturaExternaId: 'sub-1' };

describe('WebhookPagamentoWorker — consumidor assíncrono (compensação RAD-253)', () => {
  it('delega ao use case', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const worker = new WebhookPagamentoWorker({ executar } as unknown as ProcessarEventoDePagamentoUseCase);

    await worker.processar(COMANDO, SIGNAL);

    expect(executar).toHaveBeenCalledExactlyOnceWith(COMANDO, SIGNAL);
  });

  it('erro de infraestrutura do use case relança (fila reentrega)', async () => {
    const executar = vi.fn().mockRejectedValue(new Error('db indisponível'));
    const worker = new WebhookPagamentoWorker({ executar } as unknown as ProcessarEventoDePagamentoUseCase);

    await expect(worker.processar(COMANDO, SIGNAL)).rejects.toThrow('db indisponível');
  });
});
