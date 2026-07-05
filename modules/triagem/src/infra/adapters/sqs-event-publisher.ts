import type { DomainEvent } from '../../application/events.js';
import type { EventPublisher } from '../../application/ports.js';

/**
 * Client mínimo de fila, provider-agnóstico — a tecnologia concreta (SQS / RabbitMQ / Redis Streams,
 * A01 §4 [A VALIDAR]) é ligada no composition root; só o contrato mínimo aparece aqui (P-74). Mesmo
 * seam do `SqsEventPublisher` do Matching. O `AbortSignal` (P-78) entra em `opts.abortSignal` e chega ao
 * envio real — regra do ÚLTIMO HOP (arq/10 §10): o sinal precisa atingir a borda de I/O do adapter
 * (aqui, o `sendMessage`), não parar na assinatura do port; senão um pedido já abortado ainda
 * enfileira → worker roda triagem PAGA órfã (fronteira AB9/cost-DoS).
 */
interface QueueClient {
  sendMessage(
    params: { QueueUrl: string; MessageBody: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void>;
}

/**
 * Publicador de eventos de domínio (`triagem.solicitada`/`triagem.concluida` — A17 §8) na fila.
 * Cada mensagem carrega `type`, `occurredAt` e o `payload` mínimo (que já leva `tenantId`, mesmo no
 * MVP single-tenant — A01 §6). Serializa, propaga o `AbortSignal` (P-78, último hop) e envia; a
 * topologia da fila é decisão de infra.
 */
export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: QueueClient,
    private readonly queueUrl: string,
  ) {}

  async publicar(evento: DomainEvent, signal: AbortSignal): Promise<void> {
    await this.client.sendMessage(
      {
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          type: evento.type,
          occurredAt: evento.occurredAt.toISOString(),
          payload: (evento as DomainEvent & { payload?: unknown }).payload,
        }),
      },
      { abortSignal: signal },
    );
  }
}
