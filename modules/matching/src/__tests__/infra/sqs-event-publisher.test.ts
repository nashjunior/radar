import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { AlertaGerado } from '../../application/events.js';
import { SqsEventPublisher } from '../../infra/adapters/sqs-event-publisher.js';

describe('SqsEventPublisher', () => {
  const evento = new AlertaGerado({
    alertaId: AlertaId('alerta-001'),
    tenantId: TenantId('tenant-a'),
    clienteFinalId: ClienteFinalId('cliente-001'),
    criterioId: CriterioId('criterio-001'),
    editalId: EditalId('edital-001'),
    aderencia: 0.82,
  });

  it('propaga AbortSignal até o cliente de fila (P-78)', async () => {
    const signal = new AbortController().signal;
    const client = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const publisher = new SqsEventPublisher(client, 'fila-alertas');

    await publisher.publicar(evento, signal);

    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
  });

  it('propaga o abort do client (signal já abortado corta o envio)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const client = {
      sendMessage: vi.fn((_params: unknown, opts: { abortSignal: AbortSignal }) =>
        opts.abortSignal.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve(),
      ),
    };
    const publisher = new SqsEventPublisher(client, 'fila-alertas');

    await expect(publisher.publicar(evento, ctrl.signal)).rejects.toThrow('aborted');
  });
});
