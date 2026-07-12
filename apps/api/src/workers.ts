/**
 * Composition root dos workers assíncronos (P-96 §4) — cada bounded context
 * contribui seu worker aqui, gated por `WORKERS_ENABLED=true`. O worker de
 * Triagem (batch) precisa também de `ANTHROPIC_API_KEY`; os demais não.
 * P-74: único ponto do monólito que importa `@anthropic-ai/sdk` directamente.
 *
 * Transporte de fila (RAD-319, P-113): gated por `QUEUE_TRANSPORT=stub|sqs` (default `stub` —
 * publishers no-op, nenhum consumidor sobe; o merge não depende de credencial AWS). Com `sqs`,
 * os `EventPublisher` de Triagem/Cobrança/Notificação viram `SqsEventPublisher` (`@radar/kernel`,
 * RAD-194) roteados por `evento.type` (`criarPublisherRoteado`, `./infra/event-publisher-roteado.js`
 * — compartilhado com `server.ts`, RAD-328), e cada worker ganha um consumidor real
 * (`criarConsumidorSqs`, RAD-318). Fila sem `<NOME>_QUEUE_URL` (RAD-321) não sobe/publica — só
 * loga (item 6: nunca falha o boot da API por uma fila ainda não provisionada).
 */

import { SQSClient } from '@aws-sdk/client-sqs';
import Anthropic from '@anthropic-ai/sdk';
import {
  ExtrairEditaisEmLoteUseCase,
  ReenfileirarTriagensPendentesUseCase,
  TriarEditalUseCase,
  type EventPublisher as TriagemEventPublisher,
  type ExtracaoRepository,
  type ObjectStorage,
  type PerfilGateway,
  type UsoLlmLedger,
} from '@radar/triagem';
import {
  AnexoDisponibilidadeWorker,
  AnthropicBatchLlmGateway,
  AnthropicLlmGateway,
  AnthropicSdkClient,
  TriagemBatchWorker,
  TriagemSolicitadaWorker,
  type AnexoResolvidoMsg,
  type MessageBatchesClient,
  type MessagesClient,
  type TriagemSolicitadaMsg,
} from '@radar/triagem/infra';
import {
  ConfirmarUsoUseCase,
  IniciarTrialUseCase,
  LiberarReservaUseCase,
  type AssinaturaRepository,
  type EventPublisher as CobrancaEventPublisher,
  type IdProvider,
  type RegistroDeUsoRepository,
} from '@radar/cobranca';
import { CobrancaWorker } from '@radar/cobranca/infra';
import type { DocumentosDoEditalPort } from '@radar/ingestao';
import { RegistroDeUsoId, type EditalId } from '@radar/kernel';
import type { AnexosDTO } from '@radar/ingestao';
import {
  EnviarDigestUseCase,
  NotificarAlertaUseCase,
  type AlertaRepository as NotificacaoAlertaRepository,
  type ClienteFinalGateway,
  type EventPublisher as NotificacaoEventPublisher,
  type NotificacaoRepository,
  type Notifier,
} from '@radar/notificacao';
import { CryptoIdProvider as CryptoIdProviderNotificacao, NotificacaoWorker } from '@radar/notificacao/infra';
import { ReconciliarPrazoCriticoUseCase, type EventPublisher as MatchingEventPublisher } from '@radar/matching';
import {
  criarMatchingComposicao,
  ReconciliadorPrazoCriticoScheduler,
  INTERVALO_RECONCILIADOR_PRAZO_CRITICO_MS_PADRAO,
  type MatchingComposicao,
} from '@radar/matching/infra';
import { criarLogger, type Logger } from '@radar/observabilidade';
import { DocumentosEditalAclAdapter } from './infra/documentos-edital-acl-adapter.js';
import { triagemStub } from './infra/triagem-stub.js';
import { preferenciaStub } from './infra/notificacao-stub.js';
import { systemClock } from './infra/system-clock.js';
import { criarEventPublisherComMetricas, metricaDeCicloFalhou } from './observabilidade-metricas.js';
import { criarEventPublisherComCoberturaPrazoCritico } from './cobertura-prazo-critico-assinante.js';
import { SqsQueueClient } from './infra/sqs-queue-client.js';
import { criarPublisherRoteado, resolverQueueUrl } from './infra/event-publisher-roteado.js';
import {
  criarConsumidorSqs,
  type ConsumidorSqsClient,
  type ConsumidorSqsHandler,
} from './infra/sqs-consumidor.js';
import { criarPool, PgDbClient } from './infra/pg-db-client.js';

const loggerCobranca = criarLogger('worker:cobranca');
const loggerTriagemBatch = criarLogger('worker:triagem-batch');
const loggerTriagemSolicitada = criarLogger('worker:triagem-solicitada');
const loggerNotificacao = criarLogger('worker:notificacao');
const loggerMatching = criarLogger('worker:matching');

/** `dev | staging | prod` — dimensão fixa `ambiente` dos alarmes de RAD-304 (A18 §5). */
const AMBIENTE = process.env['AMBIENTE'] ?? 'dev';

export interface WorkersHandle {
  /** `null` quando `ANTHROPIC_API_KEY` está ausente — só este worker depende dela. */
  worker: TriagemBatchWorker | null;
  /** `null` pela mesma razão de `worker`: `TriarEditalUseCase` também depende do `LlmGateway` (RAD-259). */
  triagemSolicitadaWorker: TriagemSolicitadaWorker | null;
  cobrancaWorker: CobrancaWorker;
  /** Consumidor de `anexo.aprovado`/`anexo.rejeitado` (P-110/RAD-281) — não depende de LLM. */
  anexoDisponibilidadeWorker: AnexoDisponibilidadeWorker;
  /** Consumidor de `alerta.gerado` (RAD-316) — fecha o composition root da Notificação; não depende de LLM. */
  notificacaoWorker: NotificacaoWorker;
  /** Composto junto de `notificacaoWorker` (RAD-316); scheduler de disparo ainda não ligado (sem fonte real de destinatários — P-83/ACL). */
  enviarDigestUseCase: EnviarDigestUseCase;
  /** `null` fora de `QUEUE_TRANSPORT=sqs` ou sem `DATABASE_URL` — RAD-319 item 5 (RAD-317: sem variante stub). */
  matchingComposicao: MatchingComposicao | null;
  teardown(): void;
}

/** Stub no-op de ExtracaoRepository — substituir por PostgresExtracaoRepository quando DB provisionado. */
const extracaoStubWorkers: ExtracaoRepository = {
  async porEdital(_id, _signal) {
    return null;
  },
  async salvar(_extracao, _signal) {
    /* stub */
  },
};

/** Stub no-op de ObjectStorage — substituir por S3ObjectStorage quando storage provisionado. */
const objectStorageStub: ObjectStorage = {
  async obterTextoAnexo(_ref, _signal) {
    return '';
  },
};

/** Stub no-op de UsoLlmLedger — substituir por PostgresUsoLlmLedger quando DB provisionado (RAD-230). */
const usoLedgerStub: UsoLlmLedger = {
  async registrar(_registro, _signal) {
    /* stub */
  },
  async gastoUsdNaJanela(_escopo, _desde, _signal) {
    return 0; // stub: sem DB, admission control por orçamento (RAD-243) nunca vê gasto acumulado
  },
};

/** Stub no-op de DocumentosDoEditalPort — substituir quando Postgres da Ingestão estiver provisionado. */
const documentosPortStub: DocumentosDoEditalPort = {
  async obterDocumentos(editalId: EditalId, _signal: AbortSignal): Promise<AnexosDTO> {
    return { editalId, arquivos: [] };
  },
};

/** Stub no-op de PerfilGateway — substituir pelo ACL de Identidade & Organização (P-43) quando provisionado; retorna null (→ PerfilNaoEncontradoError) até lá. */
const perfilGatewayStub: PerfilGateway = {
  async porId(_id, _signal) {
    return null;
  },
};

/** Fallback no-op de EventPublisher da Triagem — usado quando `QUEUE_TRANSPORT=stub` (default) OU quando nenhuma das 3 filas de Triagem tem `QUEUE_URL` configurada. */
const eventosTriagemStubBase: TriagemEventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};

/** Fallback no-op de EventPublisher da Notificação — mesma regra de `eventosTriagemStubBase`. */
const eventosNotificacaoStubBase: NotificacaoEventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};

/** Fallback no-op de EventPublisher da Cobrança — mesma regra de `eventosTriagemStubBase`; sem decoração de métrica (nunca teve — `assinatura.cota_alerta` não tem SLO em `observabilidade-metricas.ts`). */
const eventosStub: CobrancaEventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};

/**
 * Stub no-op de AssinaturaRepository — substituir por PostgresAssinaturaRepository
 * (`@radar/cobranca/infra`, RAD-246) quando o composition root ganhar `DbClient` real.
 * Sem persistência, `porTenantId` sempre retorna `null` — todo `triagem.concluida`
 * vai para a DLQ da Cobrança até o DB estar provisionado (mesma realidade dos
 * demais stubs deste arquivo, ex. `extracaoStubWorkers`).
 */
const assinaturasStub: AssinaturaRepository = {
  async porTenantId(_tenantId, _signal) {
    return null;
  },
  async porAssinaturaExternaId(_assinaturaExternaId, _signal) {
    return null;
  },
  async salvar(_assinatura, _signal) {
    /* stub */
  },
  async reservarCota(_tenantId, _signal) {
    return false;
  },
  async liberarReserva(_tenantId, _signal) {
    /* stub */
  },
  async confirmarUso(_tenantId, _signal) {
    /* stub */
  },
};

/** Stub no-op de RegistroDeUsoRepository — substituir por adapter Postgres quando DB provisionado (RAD-247). */
const registrosDeUsoStub: RegistroDeUsoRepository = {
  async registrar(_registro, _signal) {
    return true;
  },
};

/** Stub incremental de IdProvider — substituir por CryptoIdProvider quando a infra do módulo existir (RAD-247). */
let proximoRegistroDeUsoIdStub = 0;
const idsStub: IdProvider = {
  gerar() {
    proximoRegistroDeUsoIdStub += 1;
    return RegistroDeUsoId(`registro-uso-stub-${proximoRegistroDeUsoIdStub}`);
  },
};

/** Stub no-op de AlertaRepository (Notificação) — substituir por view read-only Postgres quando DB provisionado. */
const alertaRepositoryNotificacaoStub: NotificacaoAlertaRepository = {
  async porId(_id, _signal) {
    return null;
  },
  async pendentesDigest(_params, _signal) {
    return { selecionados: [], excedentes: [], totalPendentes: 0 };
  },
};

/** Stub no-op de NotificacaoRepository — substituir por PostgresNotificacaoRepository quando DB provisionado. */
const notificacaoRepositoryStub: NotificacaoRepository = {
  async salvar(_notificacao, _signal) {
    /* stub */
  },
  async jaNotificado(_alertaId, _usuarioId, _signal) {
    return false;
  },
};

/** Stub no-op de Notifier — substituir por SesNotifier quando SES provisionado. */
const notifierStub: Notifier = {
  async enviar(_params) {
    /* stub */
  },
};

/** Stub no-op de ClienteFinalGateway — substituir pelo ACL de Identidade (mesmo padrão de `perfilGatewayStub`) quando provisionado; retorna null até lá. */
const clienteFinalGatewayStub: ClienteFinalGateway = {
  async porId(_id, _signal) {
    return null;
  },
};

// ---------------------------------------------------------------------------
// DLQ de aplicação (P-107 (c), P-113 (4)) — compensação semântica, não transporte: o broker já
// move a mensagem envenenada via `redrive_policy` (módulo `queue`); isto só registra o descarte
// para ops. Mesma fábrica para os cinco consumidores deste composition root — antes de RAD-319
// eram objetos soltos que nunca chegavam a ser exercitados por um consumidor real.
// ---------------------------------------------------------------------------

function criarDlqLogger<T>(
  logger: Logger,
  evento: string,
  msg: string,
  chave: (m: T) => Record<string, unknown>,
): { encaminhar(m: T, err: unknown): Promise<void> } {
  return {
    async encaminhar(m: T, err: unknown): Promise<void> {
      logger.error(evento, msg, { ...chave(m), erro: err });
    },
  };
}

const dlqTriagemBatch = criarDlqLogger<{ editalId: string }>(
  loggerTriagemBatch,
  'dlq.edital-descartado',
  'edital descartado',
  (m) => ({ editalId: m.editalId }),
);

const dlqTriagemSolicitada = criarDlqLogger<TriagemSolicitadaMsg>(
  loggerTriagemSolicitada,
  'dlq.triagem-solicitada-descartada',
  'triagem.solicitada descartada',
  (m) => ({ editalId: m.editalId }),
);

interface TriagemConcluidaMsg {
  tenantId: string;
  clienteFinalId: string;
  editalId: string;
  perfilId: string;
}

interface TriagemFalhouMsg {
  tenantId: string;
}

interface OrganizacaoProvisionadaMsg {
  tenantId: string;
}

const dlqCobranca = criarDlqLogger<TriagemConcluidaMsg>(
  loggerCobranca,
  'dlq.triagem-concluida-descartada',
  'triagem.concluida descartada',
  (m) => ({ tenantId: m.tenantId }),
);

/** Contrato canônico de `alerta.gerado` (A03 §3) — mesmo replicado localmente que `NotificacaoWorker` usa. */
interface AlertaGeradoMsg {
  alertaId: string;
  tenantId: string;
  clienteFinalId: string;
  alertaGeradoEm: string;
  imediato: boolean;
}

const dlqNotificacao = criarDlqLogger<AlertaGeradoMsg>(
  loggerNotificacao,
  'dlq.alerta-gerado-descartado',
  'alerta.gerado descartado',
  (m) => ({ alertaId: m.alertaId }),
);

// ---------------------------------------------------------------------------
// Transporte real (RAD-319, RAD-318, P-113) — helpers de fila via env (RAD-321)
// ---------------------------------------------------------------------------

interface FilaConsumo {
  readonly queueUrl: string;
  readonly maxReceiveCount: number;
}

/** `<NOME>_QUEUE_URL`/`<NOME>_MAX_RECEIVE_COUNT` — o consumidor lê o contador do próprio módulo `queue` (nunca adivinha; default 5 = `variables.tf`). */
function resolverFilaConsumo(nome: string): FilaConsumo | null {
  const queueUrl = resolverQueueUrl(nome);
  if (!queueUrl) return null;
  return { queueUrl, maxReceiveCount: Number(process.env[`${nome}_MAX_RECEIVE_COUNT`] ?? '5') };
}

/**
 * Sobe um consumidor `criarConsumidorSqs` (RAD-318) para `nome`. Sem `<NOME>_QUEUE_URL`
 * (RAD-321), não sobe — só loga (item 6: nunca falha o boot da API por uma fila ainda não
 * provisionada).
 */
function iniciarConsumidor<T>(
  client: ConsumidorSqsClient,
  nome: string,
  fila: FilaConsumo | null,
  handler: ConsumidorSqsHandler<T>,
  logger: Logger,
  controllers: AbortController[],
): void {
  if (!fila) {
    logger.warn('consumidor.nao-iniciado', `consumidor de ${nome} não subiu — QUEUE_URL ausente`, { fila: nome });
    return;
  }
  const controller = new AbortController();
  controllers.push(controller);
  criarConsumidorSqs<T>({
    client,
    queueUrl: fila.queueUrl,
    maxReceiveCount: fila.maxReceiveCount,
    signal: controller.signal,
    handler,
  }).catch((err) => {
    logger.error('consumidor.crash', `consumidor de ${nome} encerrou com erro inesperado`, { erro: err });
  });
  logger.info('consumidor.iniciado', `consumidor de ${nome} iniciado`, { fila: nome, filaUrl: fila.queueUrl });
}

/**
 * Handler-adapter do `TriagemSolicitadaWorker` (item 3): único dos quatro workers com split
 * `processar`/`processarDlq` (RAD-259) — erro de INFRA (hidratação) propaga para retry; só na
 * ÚLTIMA tentativa (`contexto.ultimaTentativa`, exposto via `ApproximateReceiveCount`, RAD-318)
 * aciona a compensação semântica (`processarDlq` publica `triagem.falhou` antes do descarte,
 * P-107 (c)) — nunca antes, nunca depois (P-113 (4)).
 */
function criarHandlerTriagemSolicitada(worker: TriagemSolicitadaWorker): ConsumidorSqsHandler<TriagemSolicitadaMsg> {
  return async (msg, signal, contexto) => {
    try {
      await worker.processar(msg, signal);
    } catch (err) {
      if (contexto.ultimaTentativa) {
        await worker.processarDlq(msg, err, signal);
        return;
      }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Matching (item 5, P-113) — `criarMatchingComposicao` exige `DbClient`+`SqsClient` reais; sem
// variante stub (RAD-317: "não inventar dublê de produção"). Só entra quando `QUEUE_TRANSPORT=sqs`
// E `DATABASE_URL` presentes; sem isso, fica `null` no `WorkersHandle` com log explícito (item 6).
// ---------------------------------------------------------------------------

const INTERVALO_DRENO_ALERTA_VAZIO_MS = 2_000;

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
 * Dreno contínuo de `ConsumidorAlertaBatch.processarLote` (buffer interno do Matching,
 * P-41/RAD-179) — não é handler-por-mensagem (`criarConsumidorSqs`), é drenagem em lote; sem
 * mensagem nova, recua `INTERVALO_DRENO_ALERTA_VAZIO_MS` antes de tentar de novo.
 */
async function iniciarDrenoAlertaBatch(composicao: MatchingComposicao, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const n = await composicao.consumidorAlertaBatch.processarLote(signal);
      if (n === 0) await esperar(INTERVALO_DRENO_ALERTA_VAZIO_MS, signal);
    } catch (err) {
      if (signal.aborted) break;
      loggerMatching.error('dreno-alerta.erro', 'ConsumidorAlertaBatch.processarLote falhou', { erro: err });
      await esperar(INTERVALO_DRENO_ALERTA_VAZIO_MS, signal);
    }
  }
}

/** Contrato canônico de `edital.ingerido` (A03 §3, P-97) que o Matching consome — mesmo replicado localmente que `MatchingWorker` usa. */
interface EditalIngeridoMatchingMsg {
  editalId: string;
  objeto: string;
  orgaoUf: string;
  valorEstimado: number | null;
  dataPublicacao: string;
  modalidadeCodigo: number;
  prazoProposta: string | null;
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
}

interface MatchingIniciado {
  readonly composicao: MatchingComposicao;
  readonly db: PgDbClient;
}

/**
 * Reconciliador de prazo crítico (P-114, A18 §5.1(3)/§6, RAD-331) — job periódico, nunca o
 * caminho síncrono da API. Gated por `RECONCILIADOR_PRAZO_CRITICO_ENABLED`, **default OFF**:
 * mesmo padrão de `INGESTAO_SCHEDULER_ENABLED` (`scheduler.ts`) — compor ≠ ligar, ligar em
 * produção é decisão de operação separada (P-113 (5)). Não depende de credencial AWS: o
 * `AlertaPrazoCriticoReconciliado` publicado não tem fila própria (arq/18 §5), só alimenta o
 * assinante evento→EMF (RAD-302) — o `EventPublisher` aqui é um stub decorado, não SQS.
 */
function iniciarReconciliadorPrazoCritico(composicao: MatchingComposicao, controllers: AbortController[]): void {
  if (process.env['RECONCILIADOR_PRAZO_CRITICO_ENABLED'] !== 'true') {
    loggerMatching.warn(
      'reconciliador-prazo-critico.nao-iniciado',
      'ReconciliadorPrazoCriticoScheduler não iniciado — RECONCILIADOR_PRAZO_CRITICO_ENABLED ausente/false',
      {},
    );
    return;
  }

  const eventosReconciliadorBase: MatchingEventPublisher = {
    async publicar(_evento, _signal) {
      /* stub — sem fila própria (arq/18 §5); o publish só existe para o assinante evento→EMF abaixo rodar */
    },
  };
  const eventosReconciliador = criarEventPublisherComMetricas(eventosReconciliadorBase, AMBIENTE);
  const reconciliarPrazoCriticoUC = new ReconciliarPrazoCriticoUseCase(
    composicao.coberturaPrazoCritico,
    eventosReconciliador,
    systemClock,
  );

  const intervaloMs = Number(
    process.env['RECONCILIADOR_PRAZO_CRITICO_INTERVALO_MS'] ?? INTERVALO_RECONCILIADOR_PRAZO_CRITICO_MS_PADRAO,
  );
  const scheduler = new ReconciliadorPrazoCriticoScheduler(reconciliarPrazoCriticoUC, {
    intervaloMs,
    aoFalhar: (erro) => {
      // SLO "0 alertas de prazo crítico perdidos" tem error budget ZERO (A18 §5.1(3)) — sem
      // esta métrica, um ciclo que lança antes de publicar AlertaPrazoCriticoReconciliado (ex.:
      // cobertura.contar quebrando no Postgres) some sem nenhum sinal medível (RAD-332).
      metricaDeCicloFalhou('alerta.prazo_critico', AMBIENTE, erro);
      loggerMatching.error(
        'reconciliador-prazo-critico.ciclo-falhou',
        'Ciclo do ReconciliarPrazoCriticoUseCase falhou',
        { erro },
      );
    },
  });

  const controller = new AbortController();
  controllers.push(controller);
  scheduler.iniciar(controller.signal);
  loggerMatching.info(
    'reconciliador-prazo-critico.iniciado',
    'ReconciliadorPrazoCriticoScheduler iniciado (RECONCILIADOR_PRAZO_CRITICO_ENABLED=true)',
    { intervaloMs },
  );
}

function iniciarMatching(sqsClient: SqsQueueClient, controllers: AbortController[]): MatchingIniciado | null {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    loggerMatching.warn('matching.nao-iniciado', 'Matching não iniciado — DATABASE_URL ausente', {});
    return null;
  }

  const alertasAGravar = resolverFilaConsumo('ALERTAS_A_GRAVAR');
  const alertasGerados = resolverQueueUrl('ALERTAS_GERADOS');
  if (!alertasAGravar || !alertasGerados) {
    loggerMatching.warn(
      'matching.nao-iniciado',
      'Matching não iniciado — ALERTAS_A_GRAVAR_QUEUE_URL/ALERTAS_GERADOS_QUEUE_URL ausente',
      { alertasAGravar: Boolean(alertasAGravar), alertasGerados: Boolean(alertasGerados) },
    );
    return null;
  }

  const dlqMatching = criarDlqLogger<{ editalId: string }>(
    loggerMatching,
    'dlq.edital-descartado-matching',
    'edital.ingerido descartado (matching)',
    (m) => ({ editalId: m.editalId }),
  );

  const db = new PgDbClient(criarPool(databaseUrl));
  const composicao = criarMatchingComposicao(db, sqsClient, dlqMatching, {
    alertaGeradoQueueUrl: alertasGerados,
    filaAlertaQueueUrl: alertasAGravar.queueUrl,
    ambiente: AMBIENTE,
  });
  loggerMatching.info('worker.iniciado', 'MatchingComposicao iniciada (DbClient+SqsClient reais)', {});

  iniciarReconciliadorPrazoCritico(composicao, controllers);

  iniciarConsumidor<EditalIngeridoMatchingMsg>(
    sqsClient,
    'EDITAIS_INGERIDOS',
    resolverFilaConsumo('EDITAIS_INGERIDOS'),
    (msg, signal) => composicao.worker.processar(msg, signal),
    loggerMatching,
    controllers,
  );

  const drenoController = new AbortController();
  controllers.push(drenoController);
  iniciarDrenoAlertaBatch(composicao, drenoController.signal).catch((err) => {
    loggerMatching.error('dreno-alerta.crash', 'dreno de ALERTAS_A_GRAVAR encerrou com erro inesperado', { erro: err });
  });

  return { composicao, db };
}

/**
 * Inicia os workers assíncronos — cada bounded context contribui o seu (P-96 §4).
 * Retorna `null` só se `WORKERS_ENABLED` estiver ausente/falso; a falta de
 * `ANTHROPIC_API_KEY` desliga apenas o worker de Triagem (`worker: null`), não o
 * de Cobrança (RAD-247), que não depende de LLM.
 */
export function iniciarWorkers(): WorkersHandle | null {
  if (process.env['WORKERS_ENABLED'] !== 'true') return null;

  // Lido a cada chamada (não em const de topo de módulo): `iniciarWorkers()` só roda uma vez em
  // produção (index.ts, no boot), mas ler aqui evita prender o gate ao valor de env do instante
  // em que o módulo foi importado pela primeira vez — mesma postura de WORKERS_ENABLED/
  // ANTHROPIC_API_KEY/DATABASE_URL abaixo, todos lidos dentro da função.
  const queueTransport: 'stub' | 'sqs' = process.env['QUEUE_TRANSPORT'] === 'sqs' ? 'sqs' : 'stub';
  // `useQueueUrlAsEndpoint: false` — o SDK, por padrão, tenta rotear cada chamada pelo HOST da
  // própria QueueUrl (para multi-região); o Radar é single-região (sa-east-1, P-27) e o host da
  // fila NUNCA diverge do endpoint do client, então isto só adiciona risco (quebra contra
  // LocalStack, cujo host de fila retornado difere do endpoint configurado) sem ganho nenhum.
  const sqsClient: SqsQueueClient | null =
    queueTransport === 'sqs' ? new SqsQueueClient(new SQSClient({ useQueueUrlAsEndpoint: false })) : null;
  const consumidorControllers: AbortController[] = [];

  // Matching sobe ANTES do publisher da Notificação: o assinante de notificacao.enviada
  // (perna `coberto`, P-114/A18 §5.2, RAD-330) decora eventosNotificacao com o
  // AlertaDevidoRepository da MESMA composição/pool do Matching — sem conexão paralela.
  let matchingComposicao: MatchingComposicao | null = null;
  let matchingDb: PgDbClient | null = null;
  if (sqsClient) {
    const matching = iniciarMatching(sqsClient, consumidorControllers);
    matchingComposicao = matching?.composicao ?? null;
    matchingDb = matching?.db ?? null;
  }

  const eventosTriagemBase: TriagemEventPublisher = sqsClient
    ? criarPublisherRoteado(
        sqsClient,
        {
          'triagem.solicitada': resolverQueueUrl('TRIAGEM_SOLICITADA'),
          'triagem.concluida': resolverQueueUrl('TRIAGEM_CONCLUIDA'),
          'triagem.falhou': resolverQueueUrl('TRIAGEM_FALHOU'),
        },
        loggerTriagemSolicitada,
      )
    : eventosTriagemStubBase;
  // Assinante evento→EMF (A18 §5, RAD-302) decorando o publisher da Triagem — emite
  // `triagem.latencia_ms` antes de delegar ao publish real (item 2: decora o real, não o stub).
  const eventosTriagem: TriagemEventPublisher = criarEventPublisherComMetricas(eventosTriagemBase, AMBIENTE);

  // Cobrança nunca teve decoração de métrica (assinatura.cota_alerta não tem SLO associado) —
  // preservado tal como antes de RAD-319.
  const eventosCobranca: CobrancaEventPublisher = sqsClient
    ? criarPublisherRoteado(sqsClient, { 'assinatura.cota_alerta': resolverQueueUrl('ASSINATURA_COTA_ALERTA') }, loggerCobranca)
    : eventosStub;

  const eventosNotificacaoBase: NotificacaoEventPublisher = sqsClient
    ? criarPublisherRoteado(sqsClient, { 'notificacao.enviada': resolverQueueUrl('NOTIFICACAO_ENVIADA') }, loggerNotificacao)
    : eventosNotificacaoStubBase;
  const eventosNotificacaoComMetrica: NotificacaoEventPublisher = criarEventPublisherComMetricas(eventosNotificacaoBase, AMBIENTE);
  // Assinante local de notificacao.enviada (perna `coberto`, P-114/A18 §5.2, RAD-330) — marca
  // notificado_em na projeção alerta_devido do Matching antes de delegar ao publish real. Sem
  // Matching de pé (stub/DATABASE_URL ausente), a decoração é pulada — nada a marcar.
  const eventosNotificacao: NotificacaoEventPublisher = matchingComposicao
    ? criarEventPublisherComCoberturaPrazoCritico(eventosNotificacaoComMetrica, matchingComposicao.alertaDevidos, loggerNotificacao)
    : eventosNotificacaoComMetrica;

  const confirmarUsoUC = new ConfirmarUsoUseCase(assinaturasStub, registrosDeUsoStub, idsStub, eventosCobranca);
  const liberarReservaUC = new LiberarReservaUseCase(assinaturasStub);
  // RAD-285: consumidor de organizacao.provisionada — inicia o trial (P-109 L0/RAD-269).
  const iniciarTrialUC = new IniciarTrialUseCase(assinaturasStub, systemClock);
  const cobrancaWorker = new CobrancaWorker(confirmarUsoUC, liberarReservaUC, dlqCobranca, iniciarTrialUC);
  loggerCobranca.info('worker.iniciado', 'CobrancaWorker iniciado (consumidor de triagem.concluida/triagem.falhou/organizacao.provisionada)');

  // Não depende de LLM (só de TriagemRepository/DocumentosEditalGateway/EventPublisher) — iniciado
  // mesmo sem ANTHROPIC_API_KEY, ao contrário de worker/triagemSolicitadaWorker abaixo.
  const documentosGateway = new DocumentosEditalAclAdapter(documentosPortStub);
  const reenfileirarTriagensPendentesUC = new ReenfileirarTriagensPendentesUseCase(
    triagemStub,
    documentosGateway,
    eventosTriagem,
  );
  const anexoDisponibilidadeWorker = new AnexoDisponibilidadeWorker(reenfileirarTriagensPendentesUC);
  loggerTriagemSolicitada.info('worker.iniciado', 'AnexoDisponibilidadeWorker iniciado (consumidor de anexo.aprovado/anexo.rejeitado → reenfileira triagem.solicitada, P-110/RAD-281)');

  // RAD-316: fecha o composition root da Notificação, ausente até aqui — não depende de LLM.
  const idProviderNotificacao = new CryptoIdProviderNotificacao();
  const notificarAlertaUC = new NotificarAlertaUseCase(
    alertaRepositoryNotificacaoStub,
    preferenciaStub,
    notificacaoRepositoryStub,
    notifierStub,
    eventosNotificacao,
    idProviderNotificacao,
    clienteFinalGatewayStub,
  );
  const notificacaoWorker = new NotificacaoWorker(notificarAlertaUC, dlqNotificacao);
  const enviarDigestUseCase = new EnviarDigestUseCase(
    alertaRepositoryNotificacaoStub,
    preferenciaStub,
    notificacaoRepositoryStub,
    notifierStub,
    eventosNotificacao,
    idProviderNotificacao,
  );
  loggerNotificacao.info('worker.iniciado', 'NotificacaoWorker iniciado (consumidor de alerta.gerado → NotificarAlertaUseCase)');

  if (sqsClient) {
    iniciarConsumidor<TriagemConcluidaMsg>(
      sqsClient,
      'TRIAGEM_CONCLUIDA',
      resolverFilaConsumo('TRIAGEM_CONCLUIDA'),
      (msg, signal) => cobrancaWorker.processarTriagemConcluida(msg, signal),
      loggerCobranca,
      consumidorControllers,
    );
    iniciarConsumidor<TriagemFalhouMsg>(
      sqsClient,
      'TRIAGEM_FALHOU',
      resolverFilaConsumo('TRIAGEM_FALHOU'),
      (msg, signal) => cobrancaWorker.processarTriagemFalhou(msg, signal),
      loggerCobranca,
      consumidorControllers,
    );
    iniciarConsumidor<OrganizacaoProvisionadaMsg>(
      sqsClient,
      'ORGANIZACAO_PROVISIONADA',
      resolverFilaConsumo('ORGANIZACAO_PROVISIONADA'),
      (msg, signal) => cobrancaWorker.processarOrganizacaoProvisionada(msg, signal),
      loggerCobranca,
      consumidorControllers,
    );
    iniciarConsumidor<AnexoResolvidoMsg>(
      sqsClient,
      'ANEXO_RESOLVIDO',
      resolverFilaConsumo('ANEXO_RESOLVIDO'),
      (msg, signal) => anexoDisponibilidadeWorker.processar(msg, signal),
      loggerTriagemSolicitada,
      consumidorControllers,
    );
    iniciarConsumidor<AlertaGeradoMsg>(
      sqsClient,
      'ALERTAS_GERADOS',
      resolverFilaConsumo('ALERTAS_GERADOS'),
      (msg, signal) => notificacaoWorker.processar(msg, signal),
      loggerNotificacao,
      consumidorControllers,
    );
  }

  /** `pool.end()` best-effort — SIGTERM (`index.ts`) não aguarda `teardown()`, então isto é fire-and-forget. */
  function encerrarMatchingDb(): void {
    matchingDb?.encerrar().catch((err) => {
      loggerMatching.error('worker.encerrado-erro', 'PgDbClient.encerrar() falhou', { erro: err });
    });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    loggerTriagemBatch.warn('worker.nao-iniciado', 'ANTHROPIC_API_KEY ausente — TriagemBatchWorker/TriagemSolicitadaWorker não iniciados');
    return {
      worker: null,
      triagemSolicitadaWorker: null,
      cobrancaWorker,
      anexoDisponibilidadeWorker,
      notificacaoWorker,
      enviarDigestUseCase,
      matchingComposicao,
      teardown() {
        for (const controller of consumidorControllers) controller.abort();
        encerrarMatchingDb();
        loggerCobranca.info('worker.encerrado', 'CobrancaWorker encerrado');
      },
    };
  }

  const anthropic = new Anthropic({ apiKey });

  const sdkClient = new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient);

  const batchGateway = new AnthropicBatchLlmGateway(
    anthropic.messages.batches as unknown as MessageBatchesClient,
  );

  const extrairLoteUC = new ExtrairEditaisEmLoteUseCase(
    batchGateway,
    extracaoStubWorkers,
    objectStorageStub,
    usoLedgerStub,
  );

  const worker = new TriagemBatchWorker(extrairLoteUC, documentosGateway, objectStorageStub, dlqTriagemBatch);

  loggerTriagemBatch.info('worker.iniciado', 'TriagemBatchWorker iniciado (ANTHROPIC_API_KEY presente)');

  // RAD-259: fecha o pré-requisito de RAD-257 — antes, `triagem.solicitada` não tinha consumidor.
  const llmGateway = new AnthropicLlmGateway(sdkClient);
  const triarEditalUC = new TriarEditalUseCase(
    extracaoStubWorkers,
    perfilGatewayStub,
    llmGateway,
    triagemStub,
    eventosTriagem,
    usoLedgerStub,
  );
  const triagemSolicitadaWorker = new TriagemSolicitadaWorker(
    triarEditalUC,
    documentosGateway,
    objectStorageStub,
    eventosTriagem,
    dlqTriagemSolicitada,
  );
  loggerTriagemSolicitada.info('worker.iniciado', 'TriagemSolicitadaWorker iniciado (consumidor de triagem.solicitada → TriarEditalUseCase)');

  if (sqsClient) {
    iniciarConsumidor<TriagemSolicitadaMsg>(
      sqsClient,
      'TRIAGEM_SOLICITADA',
      resolverFilaConsumo('TRIAGEM_SOLICITADA'),
      criarHandlerTriagemSolicitada(triagemSolicitadaWorker),
      loggerTriagemSolicitada,
      consumidorControllers,
    );
  }

  return {
    worker,
    triagemSolicitadaWorker,
    cobrancaWorker,
    anexoDisponibilidadeWorker,
    notificacaoWorker,
    enviarDigestUseCase,
    matchingComposicao,
    teardown() {
      for (const controller of consumidorControllers) controller.abort();
      encerrarMatchingDb();
      worker.teardown();
      loggerTriagemBatch.info('worker.encerrado', 'TriagemBatchWorker encerrado');
      loggerCobranca.info('worker.encerrado', 'CobrancaWorker encerrado');
    },
  };
}
