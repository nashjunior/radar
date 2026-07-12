/**
 * Integração RAD-318 (P-113 (a), A03 §3.1) — as duas peças de transporte real que faltavam:
 * `SqsQueueClient` (client concreto sobre `@aws-sdk/client-sqs`) e `criarConsumidorSqs`
 * (consumidor long-poll). Contra LocalStack real (mesmo padrão de
 * `tests/e2e/src/helpers/localstack.ts`) — NÃO AWS (credencial AWS inválida, RAD-130/RAD-241,
 * não bloqueia esta issue).
 *
 * Docker-gated: pula silenciosamente quando Docker não está disponível (mesma postura de
 * `tests/e2e/src/cenarios/fila-sqs.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { comCorrelacao } from '@radar/observabilidade';
import { SqsQueueClient } from '../../infra/sqs-queue-client.js';
import { criarConsumidorSqs, type ConsumidorSqsContexto } from '../../infra/sqs-consumidor.js';

let container: StartedLocalStackContainer | null = null;
let sqs: SQSClient | null = null;

beforeAll(async () => {
  try {
    container = await new LocalstackContainer('localstack/localstack:3').start();
    sqs = new SQSClient({
      endpoint: container.getConnectionUri(),
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  } catch {
    // Docker não disponível (RAD-130) — testes pulados silenciosamente
  }
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

async function criarFilaComDlq(
  nome: string,
  maxReceiveCount: number,
  visibilityTimeout: number,
): Promise<{ filaUrl: string; dlqUrl: string }> {
  const { QueueUrl: dlqUrl } = await sqs!.send(new CreateQueueCommand({ QueueName: `${nome}-dlq` }));
  const { Attributes } = await sqs!.send(
    new GetQueueAttributesCommand({ QueueUrl: dlqUrl!, AttributeNames: ['QueueArn'] }),
  );
  const { QueueUrl: filaUrl } = await sqs!.send(
    new CreateQueueCommand({
      QueueName: nome,
      Attributes: {
        VisibilityTimeout: String(visibilityTimeout),
        RedrivePolicy: JSON.stringify({
          maxReceiveCount: String(maxReceiveCount),
          deadLetterTargetArn: Attributes!.QueueArn,
        }),
      },
    }),
  );
  return { filaUrl: filaUrl!, dlqUrl: dlqUrl! };
}

async function aguardar(condicao: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condicao()) return;
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error('condição não satisfeita dentro do timeout');
}

async function aguardarMensagem(queueUrl: string, timeoutMs: number): Promise<Message> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { Messages } = await sqs!.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    );
    if (Messages?.[0]) return Messages[0];
  }
  throw new Error(`Nenhuma mensagem recebida em ${timeoutMs}ms (fila: ${queueUrl})`);
}

describe('RAD-318 — SqsQueueClient + criarConsumidorSqs contra LocalStack real', () => {
  it(
    'publica → consumidor recebe → handler chamado com o payload desempacotado → deleta em sucesso (não reaparece)',
    async () => {
      if (!sqs) return; // Docker não disponível — pula

      const { filaUrl } = await criarFilaComDlq('rad318-happy', 3, 30);
      const client = new SqsQueueClient(sqs);

      const chamadas: Array<{ payload: unknown; contexto: ConsumidorSqsContexto }> = [];
      const controller = new AbortController();

      const consumidor = criarConsumidorSqs<{ editalId: string }>({
        client,
        queueUrl: filaUrl,
        maxReceiveCount: 3,
        signal: controller.signal,
        handler: async (payload, _signal, contexto) => {
          chamadas.push({ payload, contexto });
        },
      });

      // Publica dentro de um escopo de correlação, como o `SqsEventPublisher` real faria — o
      // consumidor precisa desempacotar `payload` do envelope, não o envelope inteiro.
      await comCorrelacao('4bf92f3577b34da6a3ce929d0e0e4736', () =>
        sqs!.send(
          new SendMessageCommand({
            QueueUrl: filaUrl,
            MessageBody: JSON.stringify({
              type: 'edital.ingerido',
              occurredAt: new Date().toISOString(),
              payload: { editalId: 'edital-rad318-1' },
              correlationId: '4bf92f3577b34da6a3ce929d0e0e4736',
            }),
          }),
        ),
      );

      await aguardar(() => chamadas.length >= 1);
      controller.abort();
      await consumidor; // shutdown gracioso — a promise resolve sem lançar

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.payload).toEqual({ editalId: 'edital-rad318-1' });
      expect(chamadas[0]?.contexto).toEqual({ tentativa: 1, ultimaTentativa: false });

      const { Messages } = await sqs!.send(
        new ReceiveMessageCommand({ QueueUrl: filaUrl, WaitTimeSeconds: 1 }),
      );
      expect(Messages ?? []).toHaveLength(0); // deletada em sucesso — não reaparece
    },
    30_000,
  );

  it(
    'handler sempre falha → cada entrega expõe ApproximateReceiveCount; na N-ésima o worker vê ultimaTentativa=true antes do broker mover a mensagem para a DLQ',
    async () => {
      if (!sqs) return; // Docker não disponível — pula

      const MAX_RECEBIMENTOS = 2;
      const VIS_TIMEOUT_S = 2;
      const { filaUrl, dlqUrl } = await criarFilaComDlq('rad318-falha', MAX_RECEBIMENTOS, VIS_TIMEOUT_S);
      const client = new SqsQueueClient(sqs);

      const contextos: ConsumidorSqsContexto[] = [];
      const controller = new AbortController();

      const consumidor = criarConsumidorSqs<{ editalId: string }>({
        client,
        queueUrl: filaUrl,
        maxReceiveCount: MAX_RECEBIMENTOS,
        visibilityTimeout: VIS_TIMEOUT_S,
        signal: controller.signal,
        handler: async (_payload, _signal, contexto) => {
          contextos.push(contexto);
          throw new Error('falha simulada — handler nunca tem sucesso (exercita o esgotamento de tentativas)');
        },
      });

      await sqs!.send(
        new SendMessageCommand({
          QueueUrl: filaUrl,
          MessageBody: JSON.stringify({
            type: 'edital.ingerido',
            occurredAt: new Date().toISOString(),
            payload: { editalId: 'edital-rad318-falha' },
          }),
        }),
      );

      // Falha não deleta — a mensagem reaparece após o visibility timeout e é reentregue
      // (redrive real do broker, não simulado): duas entregas, a segunda já com ultimaTentativa.
      await aguardar(() => contextos.length >= MAX_RECEBIMENTOS, 20_000);

      expect(contextos[0]).toEqual({ tentativa: 1, ultimaTentativa: false });
      expect(contextos[1]).toEqual({ tentativa: 2, ultimaTentativa: true });

      // Após a última tentativa falhar sem deleção, o broker move a mensagem para a DLQ —
      // a fila principal não a reentrega mais.
      const dlqMsg = await aguardarMensagem(dlqUrl, 15_000);
      expect(JSON.parse(dlqMsg.Body!)).toMatchObject({ payload: { editalId: 'edital-rad318-falha' } });

      controller.abort();
      await consumidor; // shutdown gracioso mesmo em caminho de falha contínua

      expect(contextos).toHaveLength(MAX_RECEBIMENTOS); // nenhuma tentativa a mais depois da DLQ
    },
    30_000,
  );
});
