import type { DomainEvent } from './events.js';

/**
 * Client mínimo de fila, provider-agnóstico — a tecnologia concreta (SQS / RabbitMQ / Redis Streams,
 * A01 §4 [A VALIDAR]) é ligada no composition root; só o contrato mínimo aparece aqui (P-74).
 */
export interface QueueClient {
  sendMessage(
    params: { QueueUrl: string; MessageBody: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void>;
}

/**
 * Publicador de eventos de domínio genérico por fila (Published Language — A03 §3). Serializa
 * `{type, occurredAt, payload}` e propaga o `AbortSignal` (P-78) até o ÚLTIMO HOP (arq/10 §10):
 * o sinal precisa atingir a borda de I/O do adapter (`sendMessage`'s `opts.abortSignal`), não parar
 * na assinatura do port — senão um pedido já abortado ainda enfileira e o worker roda trabalho pago
 * órfão (fronteira AB9/cost-DoS). Tipar com o `DomainEvent` union do módulo consumidor; a classe não
 * conhece union de eventos de nenhum contexto.
 *
 * `correlationIdAtual` (opcional, terceiro parâmetro) estampa o envelope (A18 §3.2/§3.3) com o
 * trace-id do escopo corrente — sem essa peça, o `MessageBody` não muda (aditivo, não-breaking).
 * O kernel nunca importa `@radar/observabilidade` (é I/O de runtime Node, domain não pode ganhar
 * essa dependência — A18 §3.3): quem lê o `AsyncLocalStorage` e passa a função é a infra que
 * instancia este publisher (composition root de cada módulo).
 */
export class SqsEventPublisher<E extends DomainEvent = DomainEvent> {
  constructor(
    private readonly client: QueueClient,
    private readonly queueUrl: string,
    private readonly correlationIdAtual?: () => string | undefined,
  ) {}

  async publicar(evento: E, signal: AbortSignal): Promise<void> {
    const correlationId = this.correlationIdAtual?.();

    await this.client.sendMessage(
      {
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          type: evento.type,
          occurredAt: evento.occurredAt.toISOString(),
          payload: (evento as E & { payload?: unknown }).payload,
          ...(correlationId ? { correlationId } : {}),
        }),
      },
      { abortSignal: signal },
    );
  }
}
