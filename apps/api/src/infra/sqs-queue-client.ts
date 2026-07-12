import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type MessageSystemAttributeName,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { QueueClient } from '@radar/kernel';

export interface MensagemSqsRecebida {
  readonly Body: string;
  readonly ReceiptHandle: string;
  /** Atributos pedidos via `AttributeNames` (ex.: `ApproximateReceiveCount`) — ausente se não solicitado. */
  readonly Attributes?: Record<string, string>;
}

export interface ReceiveMessagesParams {
  readonly QueueUrl: string;
  readonly MaxNumberOfMessages: number;
  readonly VisibilityTimeout?: number;
  readonly WaitTimeSeconds?: number;
  readonly AttributeNames?: string[];
}

/**
 * Client concreto de SQS (A03 §3.1, RAD-318) sobre `@aws-sdk/client-sqs` — a peça que faltava
 * no composition root de `apps/api`. Implementa o `QueueClient` do kernel (`sendMessage`, usado
 * por `SqsEventPublisher`) e, estruturalmente, o `SqsClient` de `matching/infra/composicao.ts`
 * (`sendMessage`/`receiveMessages`/`deleteMessage`) — um client só serve os dois, sem duplicar
 * a integração com o SDK por módulo. `receiveMessages` aceita parâmetros adicionais opcionais
 * (`WaitTimeSeconds`, `AttributeNames`) além dos que o `SqsClient` de matching declara —
 * compatível estruturalmente com quem chama só o subconjunto básico.
 *
 * Propaga `abortSignal` até a chamada `SQSClient.send` (P-78, arq/10 §10) — o último hop de I/O.
 */
export class SqsQueueClient implements QueueClient {
  constructor(private readonly sqs: SQSClient) {}

  async sendMessage(
    params: { QueueUrl: string; MessageBody: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({ QueueUrl: params.QueueUrl, MessageBody: params.MessageBody }),
      { abortSignal: opts.abortSignal },
    );
  }

  async receiveMessages(
    params: ReceiveMessagesParams,
    opts: { abortSignal: AbortSignal },
  ): Promise<{ Messages?: MensagemSqsRecebida[] }> {
    const out = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: params.QueueUrl,
        MaxNumberOfMessages: Math.min(params.MaxNumberOfMessages, 10),
        VisibilityTimeout: params.VisibilityTimeout,
        WaitTimeSeconds: params.WaitTimeSeconds ?? 0,
        MessageSystemAttributeNames: params.AttributeNames as MessageSystemAttributeName[] | undefined,
      }),
      { abortSignal: opts.abortSignal },
    );
    const Messages = (out.Messages ?? [])
      .filter((m) => m.Body && m.ReceiptHandle)
      .map((m) => ({ Body: m.Body!, ReceiptHandle: m.ReceiptHandle!, ...(m.Attributes ? { Attributes: m.Attributes } : {}) }));
    return { Messages };
  }

  async deleteMessage(
    params: { QueueUrl: string; ReceiptHandle: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void> {
    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: params.QueueUrl, ReceiptHandle: params.ReceiptHandle }),
      { abortSignal: opts.abortSignal },
    );
  }

  async changeMessageVisibility(
    params: { QueueUrl: string; ReceiptHandle: string; VisibilityTimeout: number },
    opts: { abortSignal: AbortSignal },
  ): Promise<void> {
    await this.sqs.send(new ChangeMessageVisibilityCommand(params), { abortSignal: opts.abortSignal });
  }
}
