import { CasarEditalComCriteriosUseCase } from '../application/use-cases/casar-edital-com-criterios.js';
import { AesGcmFieldCryptoProvider } from './adapters/aes-gcm-field-crypto-provider.js';
import { CryptoAlertaIdProvider } from './adapters/crypto-id-provider.js';
import { PostgresAlertaRepository } from './adapters/postgres-alerta-repository.js';
import { PostgresCriterioRepository } from './adapters/postgres-criterio-repository.js';
import { SqsEventPublisher } from './adapters/sqs-event-publisher.js';
import { ConsumidorAlertaBatch } from './queue/consumidor-alerta-batch.js';
import { MatchingWorker } from './queue/matching-worker.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

interface SqsClient {
  sendMessage(
    params: { QueueUrl: string; MessageBody: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void>;
  receiveMessages?(
    params: { QueueUrl: string; MaxNumberOfMessages: number },
    opts: { abortSignal: AbortSignal },
  ): Promise<{ Messages?: Array<{ Body: string; ReceiptHandle: string }> }>;
  deleteMessage?(
    params: { QueueUrl: string; ReceiptHandle: string },
    opts: { abortSignal: AbortSignal },
  ): Promise<void>;
}

interface DlqClient {
  encaminhar(msg: { editalId: string }, err: unknown): Promise<void>;
}

export interface MatchingComposicaoConfig {
  /** URL da fila SQS onde alerta.gerado é publicado após batch INSERT. */
  alertaGeradoQueueUrl: string;
  /** URL da fila SQS usada como FilaAlertaPort (buffer para batch INSERT). */
  filaAlertaQueueUrl: string;
}

export interface MatchingComposicao {
  worker: MatchingWorker;
  consumidorAlertaBatch: ConsumidorAlertaBatch;
}

/**
 * Monta o MatchingWorker e o ConsumidorAlertaBatch com todos os adapters de produção (A14 §9).
 * Chamado na subida do processo — composition root (A01 §2).
 * P-41/RAD-179: use case enfileira em filaAlertaQueueUrl; ConsumidorAlertaBatch drena e faz batch INSERT.
 */
export function criarMatchingComposicao(
  db: DbClient,
  sqs: SqsClient,
  dlq: DlqClient,
  config: MatchingComposicaoConfig,
): MatchingComposicao {
  const fieldCrypto = AesGcmFieldCryptoProvider.fromEnv();
  const criterioRepo = new PostgresCriterioRepository(db, fieldCrypto);
  const alertaRepo = new PostgresAlertaRepository(db);
  const publisher = new SqsEventPublisher(sqs, config.alertaGeradoQueueUrl);
  const alertaIds = new CryptoAlertaIdProvider();

  // SQS adapter para FilaAlertaPort — produção; testes usam FilaAlertaMemoria.
  const filaAlertaSqs = new SqsFilaAlertaAdapter(sqs, config.filaAlertaQueueUrl);

  const casarEditalUC = new CasarEditalComCriteriosUseCase(
    criterioRepo,
    filaAlertaSqs,
    alertaIds,
  );

  const consumidorAlertaBatch = new ConsumidorAlertaBatch(
    filaAlertaSqs,
    alertaRepo,
    publisher,
  );

  return {
    worker: new MatchingWorker(casarEditalUC, dlq),
    consumidorAlertaBatch,
  };
}

// ---------------------------------------------------------------------------
// SQS adapter inline para FilaAlertaPort (produção; stub FilaAlertaMemoria nos testes)
// ---------------------------------------------------------------------------

import type { AlertaParaGravarPayload, FilaAlertaPort } from '../application/ports.js';

class SqsFilaAlertaAdapter implements FilaAlertaPort {
  constructor(
    private readonly sqs: SqsClient,
    private readonly queueUrl: string,
  ) {}

  async enfileirar(alerta: AlertaParaGravarPayload, signal: AbortSignal): Promise<void> {
    await this.sqs.sendMessage(
      { QueueUrl: this.queueUrl, MessageBody: JSON.stringify(alerta) },
      { abortSignal: signal },
    );
  }

  async drenar(limite: number, signal: AbortSignal): Promise<AlertaParaGravarPayload[]> {
    if (!this.sqs.receiveMessages) return [];
    const result = await this.sqs.receiveMessages(
      { QueueUrl: this.queueUrl, MaxNumberOfMessages: Math.min(limite, 10) },
      { abortSignal: signal },
    );
    const msgs = result.Messages ?? [];
    const payloads: AlertaParaGravarPayload[] = [];
    for (const msg of msgs) {
      payloads.push(JSON.parse(msg.Body) as AlertaParaGravarPayload);
      if (this.sqs.deleteMessage) {
        await this.sqs.deleteMessage(
          { QueueUrl: this.queueUrl, ReceiptHandle: msg.ReceiptHandle },
          { abortSignal: signal },
        );
      }
    }
    return payloads;
  }
}
