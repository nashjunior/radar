import type { DbClient } from '@radar/kernel';
import { emitirMetricaEmf } from '@radar/observabilidade';
import { CasarEditalComCriteriosUseCase } from '../application/use-cases/casar-edital-com-criterios.js';
import type { AlertaGerado } from '../application/events.js';
import type { AlertaDevidoRepository, CoberturaPrazoCriticoRepository } from '../application/ports.js';
import { AesGcmFieldCryptoProvider } from './adapters/aes-gcm-field-crypto-provider.js';
import { CryptoAlertaIdProvider } from './adapters/crypto-id-provider.js';
import { PostgresAlertaDevidoRepository } from './adapters/postgres-alerta-devido-repository.js';
import { PostgresAlertaRepository } from './adapters/postgres-alerta-repository.js';
import { PostgresCoberturaPrazoCriticoRepository } from './adapters/postgres-cobertura-prazo-critico-repository.js';
import { PostgresCriterioRepository } from './adapters/postgres-criterio-repository.js';
import { SqsEventPublisher } from './adapters/sqs-event-publisher.js';
import { ConsumidorAlertaBatch } from './queue/consumidor-alerta-batch.js';
import { MatchingWorker } from './queue/matching-worker.js';

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
  /** `dev | staging | prod` — dimensão fixa `ambiente` dos alarmes de RAD-304 (A18 §5). Default `dev`. */
  ambiente?: string;
}

export interface MatchingComposicao {
  worker: MatchingWorker;
  consumidorAlertaBatch: ConsumidorAlertaBatch;
  /** Perna `coberto` do read-model de cobertura de prazo crítico (P-114, A18 §5.2) — exposto
   * para o composition root da API decorar o EventPublisher da Notificação (mesma conexão,
   * sem pool paralelo). */
  alertaDevidos: AlertaDevidoRepository;
  /** Leitura do read-model local (P-114, A18 §5.2) para o `ReconciliarPrazoCriticoUseCase`
   * — composto pelo scheduler do composition root da API, nunca pelo caminho síncrono. */
  coberturaPrazoCritico: CoberturaPrazoCriticoRepository;
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
  const alertaDevidoRepo = new PostgresAlertaDevidoRepository(db);
  const coberturaPrazoCriticoRepo = new PostgresCoberturaPrazoCriticoRepository(db);
  // Assinante evento→EMF (A18 §5, RAD-302): emite alerta.frescor_ms antes de delegar ao publish
  // real — nenhum use case ganhou port de métrica, o SqsEventPublisher segue igual.
  const publisher = criarPublisherComMetrica(
    new SqsEventPublisher(sqs, config.alertaGeradoQueueUrl),
    config.ambiente ?? 'dev',
  );
  const alertaIds = new CryptoAlertaIdProvider();

  // SQS adapter para FilaAlertaPort — produção; testes usam FilaAlertaMemoria.
  const filaAlertaSqs = new SqsFilaAlertaAdapter(sqs, config.filaAlertaQueueUrl);

  const casarEditalUC = new CasarEditalComCriteriosUseCase(
    criterioRepo,
    filaAlertaSqs,
    alertaIds,
    new SystemClockProvider(),
    alertaDevidoRepo,
  );

  const consumidorAlertaBatch = new ConsumidorAlertaBatch(
    filaAlertaSqs,
    alertaRepo,
    publisher,
  );

  return {
    worker: new MatchingWorker(casarEditalUC, dlq),
    consumidorAlertaBatch,
    alertaDevidos: alertaDevidoRepo,
    coberturaPrazoCritico: coberturaPrazoCriticoRepo,
  };
}

// ---------------------------------------------------------------------------
// SQS adapter inline para FilaAlertaPort (produção; stub FilaAlertaMemoria nos testes)
// ---------------------------------------------------------------------------

import type { AlertaParaGravarPayload, ClockProvider, EventPublisher, FilaAlertaPort } from '../application/ports.js';

class SystemClockProvider implements ClockProvider {
  agora(): Date {
    return new Date();
  }
}

/**
 * Decora o `EventPublisher` real com o assinante evento→métrica (A18 §5, RAD-302): emite
 * `alerta.frescor_ms` (p95 publicação PNCP → alerta.gerado) e SEMPRE delega ao publish real —
 * falha ao emitir a métrica nunca deve impedir o publish do evento de domínio.
 */
function criarPublisherComMetrica(interno: EventPublisher, ambiente: string): EventPublisher {
  return {
    async publicar(evento, signal) {
      if (evento.type === 'alerta.gerado') {
        const { occurredAt, payload } = evento as AlertaGerado;
        emitirMetricaEmf({
          ambiente,
          metricas: [
            { nome: 'alerta.frescor_ms', valor: occurredAt.getTime() - payload.editalPublicadoEm.getTime(), unidade: 'Milliseconds' },
          ],
          campos: { tenantId: payload.tenantId },
        });
      }
      await interno.publicar(evento, signal);
    },
  };
}

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
      // JSON.stringify serializa `editalPublicadoEm: Date` como string ISO — sem revivê-la aqui,
      // `alerta.frescor_ms` (composicao.ts, RAD-302) quebra em runtime (`.getTime is not a function`)
      // só depois do round-trip real por SQS; invisível com fila em memória (Date nunca serializa).
      const raw = JSON.parse(msg.Body) as AlertaParaGravarPayload;
      payloads.push({ ...raw, editalPublicadoEm: new Date(raw.editalPublicadoEm) });
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
