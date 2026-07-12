/**
 * `InMemoriaFilaDeWebhookPagamento` — stand-in de SQS (P-27) para a compensação
 * "processamento assíncrono" (RAD-253): `enfileirar` nunca deve bloquear no
 * processamento real, e o processamento nunca deve herdar o AbortSignal do request
 * HTTP original (a resposta já foi enviada quando ele roda).
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoriaFilaDeWebhookPagamento } from '../../infra/cobranca-webhook-stub.js';
import type { ComandoPagamento } from '@radar/cobranca';

const COMANDO: ComandoPagamento = { tipo: 'PagamentoConfirmado', eventoExternoId: 'evt-1', assinaturaExternaId: 'sub-1' };

describe('InMemoriaFilaDeWebhookPagamento', () => {
  it('enfileirar não espera o worker terminar de processar (despacho assíncrono, não bloqueia)', async () => {
    // `processar` só resolve quando `liberar()` for chamado manualmente — se `enfileirar`
    // awaitasse o processamento, o `await` abaixo travaria até o teste dar timeout.
    let liberar!: () => void;
    const processamentoPendente = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const worker = { processar: vi.fn().mockReturnValue(processamentoPendente) };
    const fila = new InMemoriaFilaDeWebhookPagamento(worker);

    await fila.enfileirar(COMANDO, new AbortController().signal); // não trava — processamento ainda pendente

    liberar();
    await processamentoPendente;
    await Promise.resolve();
    expect(worker.processar).toHaveBeenCalledOnce();
  });

  it('worker recebe um AbortSignal PRÓPRIO, nunca o do request original', async () => {
    const worker = { processar: vi.fn().mockResolvedValue(undefined) };
    const fila = new InMemoriaFilaDeWebhookPagamento(worker);

    const requestController = new AbortController();
    await fila.enfileirar(COMANDO, requestController.signal);
    requestController.abort(); // simula o request HTTP encerrando logo após a resposta 202

    await Promise.resolve();
    await Promise.resolve();

    expect(worker.processar).toHaveBeenCalledOnce();
    const [, signalRecebido] = worker.processar.mock.calls[0]!;
    expect(signalRecebido).not.toBe(requestController.signal);
    expect(signalRecebido.aborted).toBe(false);
  });

  it('falha do worker não escapa de enfileirar (é logada, não propagada)', async () => {
    const worker = { processar: vi.fn().mockRejectedValue(new Error('falha assíncrona')) };
    const fila = new InMemoriaFilaDeWebhookPagamento(worker);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(fila.enfileirar(COMANDO, new AbortController().signal)).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
