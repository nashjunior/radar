import { describe, expect, it, vi } from 'vitest';
import { SqsEventPublisher, type DomainEvent } from '@radar/kernel';
import { comCorrelacao, correlationIdAtual } from '../contexto-correlacao.js';
import { correlationIdDoEnvelope } from '../envelope.js';

interface EventoDeTeste extends DomainEvent {
  readonly payload: { readonly editalId: string };
}

describe('SqsEventPublisher (kernel) estampa correlationId a partir do ALS (A18 §3.2/§3.3)', () => {
  const evento: EventoDeTeste = {
    type: 'edital.ingerido',
    occurredAt: new Date('2026-07-12T10:00:00.000Z'),
    payload: { editalId: 'edital-1' },
  };

  it('sem correlationIdAtual injetado, o MessageBody fica igual ao formato anterior (aditivo, não-breaking)', async () => {
    const client = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const publisher = new SqsEventPublisher(client, 'fila-teste');

    await publisher.publicar(evento, new AbortController().signal);

    const params = client.sendMessage.mock.calls[0]?.[0] as { MessageBody: string };
    const body = JSON.parse(params.MessageBody);
    expect(body).toEqual({ type: 'edital.ingerido', occurredAt: '2026-07-12T10:00:00.000Z', payload: { editalId: 'edital-1' } });
    expect(body.correlationId).toBeUndefined();
  });

  it('com correlationIdAtual do ALS injetado, o envelope carrega o mesmo trace-id do escopo da requisição', async () => {
    const client = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const publisher = new SqsEventPublisher(client, 'fila-teste', correlationIdAtual);

    await comCorrelacao('4bf92f3577b34da6a3ce929d0e0e4736', () => publisher.publicar(evento, new AbortController().signal));

    const params = client.sendMessage.mock.calls[0]?.[0] as { MessageBody: string };
    const envelope = JSON.parse(params.MessageBody);
    expect(envelope.correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    // Consumidor (infra): lê o envelope da fila e re-entra no contexto antes do use case.
    const { correlationId, gerado } = correlationIdDoEnvelope(envelope);
    expect(gerado).toBe(false);
    expect(correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});
