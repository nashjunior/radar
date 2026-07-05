import type { EventPublisher } from '../../application/ports.js';
import type { DomainEvent } from '../../application/events.js';

/**
 * Adaptador SQS para publicação de eventos de domínio.
 * [A VALIDAR — fila gerenciada: SQS / RabbitMQ / Redis Streams]
 *
 * Cada evento vai para uma fila/tópico dedicado (A03, §3).
 * TODO: implementar com @aws-sdk/client-sqs quando a fila for escolhida.
 */
export class SqsEventPublisher implements EventPublisher {
  // constructor(
  //   private readonly client: SQSClient,
  //   private readonly queueUrl: string,
  // ) {}

  async publicar(_evento: DomainEvent, _signal: AbortSignal): Promise<void> {
    // TODO:
    // await client.send(new SendMessageCommand({
    //   QueueUrl: this.queueUrl,
    //   MessageBody: JSON.stringify({
    //     type: _evento.type,
    //     occurredAt: _evento.occurredAt.toISOString(),
    //     payload: (_evento as Record<string, unknown>)['payload'],
    //   }),
    //   MessageGroupId: _evento.type,
    // }));
    throw new Error('SqsEventPublisher.publicar: não implementado');
  }
}
