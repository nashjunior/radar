import type { DomainEvent } from '../../application/events.js';
import type { EventPublisher } from '../../application/ports.js';

/**
 * Client mínimo de fila, provider-agnóstico — a tecnologia concreta (SQS / RabbitMQ / Redis Streams,
 * A01 §4 [A VALIDAR]) é ligada no composition root; só o contrato mínimo aparece aqui (P-74). Mesmo
 * seam do `SqsEventPublisher` do Matching.
 */
interface QueueClient {
  sendMessage(params: { QueueUrl: string; MessageBody: string }): Promise<void>;
}

/**
 * Publicador de eventos de domínio (`triagem.solicitada`/`triagem.concluida` — A17 §8) na fila.
 * Cada mensagem carrega `type`, `occurredAt` e o `payload` mínimo (que já leva `tenantId`, mesmo no
 * MVP single-tenant — A01 §6). Serializa e envia; a topologia da fila é decisão de infra.
 */
export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: QueueClient,
    private readonly queueUrl: string,
  ) {}

  async publicar(evento: DomainEvent, _signal: AbortSignal): Promise<void> {
    await this.client.sendMessage({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify({
        type: evento.type,
        occurredAt: evento.occurredAt.toISOString(),
        payload: (evento as DomainEvent & { payload?: unknown }).payload,
      }),
    });
  }
}
