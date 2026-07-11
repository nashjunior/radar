import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

export interface SqsFixture {
  container: StartedLocalStackContainer;
  sqs: SQSClient;
}

export interface QueuePair {
  filaUrl: string;
  dlqUrl: string;
}

export async function startLocalstackSqs(): Promise<SqsFixture> {
  const container = await new LocalstackContainer('localstack/localstack:3').start();
  const sqs = new SQSClient({
    endpoint: container.getConnectionUri(),
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  return { container, sqs };
}

export async function teardownLocalstack(fixture: SqsFixture): Promise<void> {
  await fixture.container.stop();
}

/**
 * Cria par fila principal + DLQ configurados com redrive policy.
 * Use `visibilityTimeout` pequeno (2–3 s) nos testes que exercitam redelivery real.
 */
export async function criarFilaComDlq(
  sqs: SQSClient,
  nome: string,
  opts: { maxReceiveCount?: number; visibilityTimeout?: number } = {},
): Promise<QueuePair> {
  const { maxReceiveCount = 3, visibilityTimeout = 30 } = opts;

  const { QueueUrl: dlqUrl } = await sqs.send(
    new CreateQueueCommand({ QueueName: `${nome}-dlq` }),
  );

  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl!,
      AttributeNames: ['QueueArn'],
    }),
  );

  const { QueueUrl: filaUrl } = await sqs.send(
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
