/**
 * Integração RAD-319 (P-113 (a)/(b), A03 §3.1) — `iniciarWorkers()` com `QUEUE_TRANSPORT=sqs`
 * fecha o loop de verdade: publica uma mensagem `anexo.aprovado` numa fila SQS real (LocalStack)
 * e verifica que o `AnexoDisponibilidadeWorker` a consome (deleta a mensagem) via o consumidor
 * long-poll (`criarConsumidorSqs`, RAD-318) subido pelo composition root — não uma ponte de
 * teste como `triagem-solicitada-dlq-fecha-loop.test.ts`.
 *
 * Docker-gated: pula silenciosamente quando Docker não está disponível (mesma postura de
 * `sqs-consumidor.integration.test.ts`, RAD-318).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import { CreateQueueCommand, GetQueueAttributesCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { iniciarWorkers } from '../../workers.js';

let container: StartedLocalStackContainer | null = null;
let sqs: SQSClient | null = null;

const ENV_KEYS = [
  'WORKERS_ENABLED',
  'QUEUE_TRANSPORT',
  'AWS_ENDPOINT_URL',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'ANEXO_RESOLVIDO_QUEUE_URL',
  'ANEXO_RESOLVIDO_MAX_RECEIVE_COUNT',
];

beforeAll(async () => {
  try {
    container = await new LocalstackContainer('localstack/localstack:3').start();
    sqs = new SQSClient({
      endpoint: container.getConnectionUri(),
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      // Sem isto, o SDK roteia pelo host da própria QueueUrl (LocalStack devolve um host que não
      // bate com a porta mapeada pelo testcontainers) — mesmo ajuste do `SqsQueueClient` de produção.
      useQueueUrlAsEndpoint: false,
    });
  } catch {
    // Docker não disponível (RAD-130) — testes pulados silenciosamente
  }
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

async function aguardar(condicao: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condicao()) return;
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error('condição não satisfeita dentro do timeout');
}

describe('RAD-319 — iniciarWorkers(QUEUE_TRANSPORT=sqs) consome uma fila real (LocalStack)', () => {
  it(
    'anexo.aprovado publicado em ANEXO_RESOLVIDO_QUEUE_URL é consumido pelo AnexoDisponibilidadeWorker (mensagem deletada, sem reaparecer)',
    async () => {
      if (!sqs) return; // Docker não disponível — pula

      const { QueueUrl: dlqUrl } = await sqs.send(new CreateQueueCommand({ QueueName: 'rad319-anexo-resolvido-dlq' }));
      const { Attributes } = await sqs.send(
        new GetQueueAttributesCommand({ QueueUrl: dlqUrl!, AttributeNames: ['QueueArn'] }),
      );
      const { QueueUrl: filaUrl } = await sqs.send(
        new CreateQueueCommand({
          QueueName: 'rad319-anexo-resolvido',
          Attributes: {
            VisibilityTimeout: '5',
            RedrivePolicy: JSON.stringify({ maxReceiveCount: '3', deadLetterTargetArn: Attributes!.QueueArn }),
          },
        }),
      );

      process.env['WORKERS_ENABLED'] = 'true';
      process.env['QUEUE_TRANSPORT'] = 'sqs';
      process.env['AWS_ENDPOINT_URL'] = container!.getConnectionUri();
      process.env['AWS_REGION'] = 'us-east-1';
      process.env['AWS_ACCESS_KEY_ID'] = 'test';
      process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
      process.env['ANEXO_RESOLVIDO_QUEUE_URL'] = filaUrl!;
      process.env['ANEXO_RESOLVIDO_MAX_RECEIVE_COUNT'] = '3';

      const handle = iniciarWorkers();
      expect(handle).not.toBeNull();

      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: filaUrl!,
            MessageBody: JSON.stringify({
              type: 'anexo.aprovado',
              occurredAt: new Date().toISOString(),
              payload: { editalId: 'edital-rad319-anexo', restamPendentes: false },
            }),
          }),
        );

        // `ApproximateNumberOfMessages*` (não um `ReceiveMessage` de teste) — um receive próprio
        // roubaria a visibilidade da mensagem do consumidor real por `VisibilityTimeout`,
        // dando falso-positivo/falso-negativo por corrida (RAD-319).
        await aguardar(async () => {
          const { Attributes } = await sqs!.send(
            new GetQueueAttributesCommand({
              QueueUrl: filaUrl!,
              AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
            }),
          );
          return (
            Attributes?.['ApproximateNumberOfMessages'] === '0' &&
            Attributes?.['ApproximateNumberOfMessagesNotVisible'] === '0'
          );
        });
      } finally {
        handle?.teardown();
      }
    },
    30_000,
  );
});
