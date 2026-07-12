import { comCorrelacao, correlationIdDoEnvelope } from '@radar/observabilidade';

export interface ConsumidorSqsContexto {
  /** `ApproximateReceiveCount` do broker — nº de entregas desta mensagem, incluindo a atual. */
  readonly tentativa: number;
  /**
   * `true` quando esta é a ÚLTIMA entrega antes do broker mover a mensagem para a DLQ
   * (redrive_policy.max_receive_count, Terraform módulo `queue`). Existe para o invariante de
   * A03 §3.1: um `DlqClient` de aplicação (compensação semântica, ex. publicar `triagem.falhou`
   * antes do descarte) só pode disparar aqui dentro — em qualquer outra tentativa, ou a
   * compensação roda cedo demais (a cota nunca chega a vazar, mas o evento sai antes da hora) ou
   * nunca roda (a cota vaza).
   */
  readonly ultimaTentativa: boolean;
}

export type ConsumidorSqsHandler<T> = (
  payload: T,
  signal: AbortSignal,
  contexto: ConsumidorSqsContexto,
) => Promise<void>;

/** Porte mínimo exigido do client de fila — `SqsQueueClient` satisfaz estruturalmente. */
export interface ConsumidorSqsClient {
  receiveMessages(
    params: {
      QueueUrl: string;
      MaxNumberOfMessages: number;
      VisibilityTimeout?: number;
      WaitTimeSeconds?: number;
      AttributeNames?: string[];
    },
    opts: { abortSignal: AbortSignal },
  ): Promise<{ Messages?: Array<{ Body: string; ReceiptHandle: string; Attributes?: Record<string, string> }> }>;
  deleteMessage(
    params: { QueueUrl: string; ReceiptHandle: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void>;
}

export interface CriarConsumidorSqsParams<T> {
  readonly client: ConsumidorSqsClient;
  readonly queueUrl: string;
  /** Handler-shaped (A03 §3.1): mesma assinatura que um handler Lambda chamaria — trocar a casca não muda o miolo. */
  readonly handler: ConsumidorSqsHandler<T>;
  /** `redrive_policy.max_receive_count` da fila (Terraform, módulo `queue`) — injetado por config; o consumidor nunca lê do broker. */
  readonly maxReceiveCount: number;
  readonly visibilityTimeout?: number;
  readonly signal: AbortSignal;
}

interface EnvelopeRecebido<T> {
  readonly payload: T;
  readonly correlationId?: string;
}

const ESPERA_ENTRE_ERROS_DE_RECEIVE_MS = 1_000;

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/**
 * Consumidor SQS long-poll (A03 §3.1, RAD-318) — a segunda peça que faltava no transporte real
 * do contrato de eventos entre módulos. Puxa mensagens (`WaitTimeSeconds=20`), delega ao
 * `handler` e só deleta em sucesso; falha deixa a mensagem voltar (o broker faz o redrive via
 * `redrive_policy` — RAD-317/P-113). Shutdown gracioso por `AbortSignal`: para de puxar novas
 * mensagens e encerra assim que o ciclo corrente termina.
 *
 * Desempacota o envelope `{type, occurredAt, payload, correlationId}` que `SqsEventPublisher`
 * (`@radar/kernel`) publica — só `payload` chega ao handler — e re-entra no `correlationId` do
 * envelope (A18 §3.2/§3.3) antes de chamar o handler, fechando a correlação ponta-a-ponta entre
 * o log de quem publicou e o log de quem consome.
 */
export async function criarConsumidorSqs<T>(params: CriarConsumidorSqsParams<T>): Promise<void> {
  const { client, queueUrl, handler, maxReceiveCount, visibilityTimeout, signal } = params;

  while (!signal.aborted) {
    let mensagens: Array<{ Body: string; ReceiptHandle: string; Attributes?: Record<string, string> }>;
    try {
      const out = await client.receiveMessages(
        {
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          AttributeNames: ['ApproximateReceiveCount'],
          ...(visibilityTimeout !== undefined ? { VisibilityTimeout: visibilityTimeout } : {}),
        },
        { abortSignal: signal },
      );
      mensagens = out.Messages ?? [];
    } catch {
      if (signal.aborted) break; // shutdown gracioso — long-poll abortado de propósito
      await esperar(ESPERA_ENTRE_ERROS_DE_RECEIVE_MS, signal); // erro transitório de infra — recua antes de tentar de novo
      continue;
    }

    for (const msg of mensagens) {
      if (signal.aborted) break;
      await processarMensagem(client, queueUrl, msg, maxReceiveCount, handler, signal);
    }
  }
}

async function processarMensagem<T>(
  client: ConsumidorSqsClient,
  queueUrl: string,
  msg: { Body: string; ReceiptHandle: string; Attributes?: Record<string, string> },
  maxReceiveCount: number,
  handler: ConsumidorSqsHandler<T>,
  signal: AbortSignal,
): Promise<void> {
  const tentativa = Number(msg.Attributes?.['ApproximateReceiveCount'] ?? '1');
  const contexto: ConsumidorSqsContexto = { tentativa, ultimaTentativa: tentativa >= maxReceiveCount };

  try {
    const envelope = JSON.parse(msg.Body) as EnvelopeRecebido<T>;
    const { correlationId } = correlationIdDoEnvelope(envelope);
    await comCorrelacao(correlationId, () => handler(envelope.payload, signal, contexto));
    await client.deleteMessage({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }, { abortSignal: signal });
  } catch {
    // Handler lançou (falha de negócio/infra) ou corpo malformado — não deleta: a mensagem volta
    // a ficar visível após o visibility timeout e o broker faz o redrive. `contexto.ultimaTentativa`
    // já foi exposto ao handler ANTES de lançar, para ele decidir a compensação (P-107 (c)) — o
    // consumidor não reinterpreta o erro nem tenta de novo por conta própria.
  }
}
