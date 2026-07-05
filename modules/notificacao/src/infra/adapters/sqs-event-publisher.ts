import type { DomainEvent } from '../../application/events.js';
import type { EventPublisher } from '../../application/ports.js';

interface SqsClient {
  sendMessage(params: { QueueUrl: string; MessageBody: string }): Promise<void>;
}

export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly sqs: SqsClient,
    private readonly queueUrl: string,
  ) {}

  async publicar(evento: DomainEvent, _signal: AbortSignal): Promise<void> {
    await this.sqs.sendMessage({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify({
        type: evento.type,
        occurredAt: evento.occurredAt.toISOString(),
        payload: (evento as DomainEvent & { payload?: unknown }).payload,
      }),
    });
  }
}
