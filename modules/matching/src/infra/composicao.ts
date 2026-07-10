import { CasarEditalComCriteriosUseCase } from '../application/use-cases/casar-edital-com-criterios.js';
import { AesGcmFieldCryptoProvider } from './adapters/aes-gcm-field-crypto-provider.js';
import { CryptoAlertaIdProvider } from './adapters/crypto-id-provider.js';
import { PostgresAlertaRepository } from './adapters/postgres-alerta-repository.js';
import { PostgresCriterioRepository } from './adapters/postgres-criterio-repository.js';
import { SqsEventPublisher } from './adapters/sqs-event-publisher.js';
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
}

interface DlqClient {
  encaminhar(msg: { editalId: string }, err: unknown): Promise<void>;
}

export interface MatchingComposicaoConfig {
  /** URL da fila SQS onde alerta.gerado é publicado. */
  alertaGeradoQueueUrl: string;
}

export interface MatchingComposicao {
  worker: MatchingWorker;
}

/**
 * Monta o MatchingWorker com todos os adapters de produção (A14 §9).
 * Chamado na subida do processo — composition root (A01 §2).
 * Os adapters de US-04/US-06 (DefinirCriterio, RegistrarFeedback) são compostos em RAD-77.
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

  const casarEditalUC = new CasarEditalComCriteriosUseCase(
    criterioRepo,
    alertaRepo,
    publisher,
    alertaIds,
  );

  return {
    worker: new MatchingWorker(casarEditalUC, dlq),
  };
}
