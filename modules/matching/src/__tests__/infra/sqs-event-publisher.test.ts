import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { AlertaGerado } from '../../application/events.js';
import { SqsEventPublisher } from '../../infra/adapters/sqs-event-publisher.js';

describe('SqsEventPublisher', () => {
  it('propaga AbortSignal até o cliente de fila (P-78)', async () => {
    const signal = new AbortController().signal;
    const client = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const publisher = new SqsEventPublisher(client, 'fila-alertas');

    await publisher.publicar(
      new AlertaGerado({
        alertaId: AlertaId('alerta-001'),
        tenantId: TenantId('tenant-a'),
        clienteFinalId: ClienteFinalId('cliente-001'),
        criterioId: CriterioId('criterio-001'),
        editalId: EditalId('edital-001'),
        aderencia: 0.82,
      }),
      signal,
    );

    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
  });
});
