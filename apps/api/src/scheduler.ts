/**
 * Composition root do scheduler de polling PNCP (docs/98 P-113 (5), decisão RAD-317) —
 * gated por `INGESTAO_SCHEDULER_ENABLED=true`, **default OFF**: ligá-lo faz `apps/api`
 * bater na PNCP real em produção, então o disparo é decisão de operação tomada depois
 * do publisher real e do circuit breaker verificados — compor ≠ ligar. Com o gate off,
 * nada muda no comportamento atual (RAD-320).
 */

import {
  IngerirAtualizacoesUseCase,
  IngerirEditaisUseCase,
  type EditalRepository,
  type EventPublisher,
  type ProvenienciaRepository,
} from '@radar/ingestao';
import {
  CircuitBreaker,
  CircuitBreakerPncpGateway,
  CryptoIdProvider,
  PncpHttpGateway,
  PncpPollingScheduler,
} from '@radar/ingestao/infra';
import { criarLogger } from '@radar/observabilidade';
import { criarEventPublisherComMetricas } from './observabilidade-metricas.js';

const logger = criarLogger('scheduler:ingestao-pncp');

/** `dev | staging | prod` — dimensão fixa `ambiente` dos alarmes de RAD-304 (A18 §5). */
const AMBIENTE = process.env['AMBIENTE'] ?? 'dev';

/** MVP: 3 modalidades dominantes ≥ 90% do volume (arq/02 §3, P-31). Ignorado no regime `atualizacao`. */
const MODALIDADES_MVP = [6, 8, 9];

/** Cadência recomendada em P-29 (arq/02 §3 · docs/12 §3) para frescor p95 ≤ 30 min. */
const INTERVALO_MS = 5 * 60 * 1000;
const TAMANHO_JANELA_MS = 35 * 60 * 1000;

/** Limiares do breaker 'PNCP' recomendados em P-34 (docs/98). */
const BREAKER_PNCP_CONFIG = {
  nome: 'PNCP',
  limiarFalhas: 5,
  timeoutAberturaMs: 2 * 60 * 1000,
  limiarSucessosSonda: 2,
};

/** Stub no-op de EditalRepository — substituir por PostgresEditalRepository quando DB provisionado. */
const editalRepositoryStub: EditalRepository = {
  async upsertPorNumeroControle(_edital, _signal) {
    /* stub */
  },
  async porId(_id, _signal) {
    return null;
  },
  async porNumeroControle(_numeroPncp, _signal) {
    return null;
  },
  async *listarPorJanelaPublicacao(_janela, _signal) {
    /* stub: nenhuma página */
  },
};

/** Stub no-op de ProvenienciaRepository — substituir por PostgresProvenienciaRepository quando DB provisionado. */
const provenienciaRepositoryStub: ProvenienciaRepository = {
  async registrar(_params, _signal) {
    /* stub */
  },
};

/**
 * Stub no-op de EventPublisher da Ingestão — substituir por `SqsEventPublisher` (kernel)
 * quando o transporte real estiver ligado (RAD-319). Decorado com o assinante evento→EMF
 * (A18 §5, RAD-302) abaixo, mesmo padrão de `eventosTriagemStub` em `workers.ts`.
 */
const eventosIngestaoStubBase: EventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};
const eventosIngestaoStub = criarEventPublisherComMetricas(eventosIngestaoStubBase, AMBIENTE);

export interface SchedulerIngestaoHandle {
  teardown(): void;
}

/**
 * Compõe o pipeline de polling PNCP — dois regimes (`publicacao` + `atualizacao`, P-29),
 * ambos com o gateway protegido pelo mesmo `CircuitBreaker` 'PNCP' (degradação graciosa,
 * arq/04 §§6-7). Retorna `null` quando `INGESTAO_SCHEDULER_ENABLED` está ausente/falso.
 */
export function iniciarSchedulerIngestao(): SchedulerIngestaoHandle | null {
  if (process.env['INGESTAO_SCHEDULER_ENABLED'] !== 'true') return null;

  const breakerPncp = new CircuitBreaker(BREAKER_PNCP_CONFIG, eventosIngestaoStub);
  const pncpGateway = new CircuitBreakerPncpGateway(new PncpHttpGateway(), breakerPncp);
  const ids = new CryptoIdProvider();

  const ingerirEditaisUC = new IngerirEditaisUseCase(
    pncpGateway,
    editalRepositoryStub,
    provenienciaRepositoryStub,
    eventosIngestaoStub,
    ids,
  );
  const ingerirAtualizacoesUC = new IngerirAtualizacoesUseCase(
    pncpGateway,
    editalRepositoryStub,
    provenienciaRepositoryStub,
    eventosIngestaoStub,
    ids,
  );

  const schedulerPublicacao = new PncpPollingScheduler(
    ingerirEditaisUC,
    { modalidades: MODALIDADES_MVP, intervaloMs: INTERVALO_MS, tamanhoJanelaMs: TAMANHO_JANELA_MS, regime: 'publicacao' },
    ingerirAtualizacoesUC,
    eventosIngestaoStub,
  );
  const schedulerAtualizacao = new PncpPollingScheduler(
    ingerirEditaisUC,
    { modalidades: MODALIDADES_MVP, intervaloMs: INTERVALO_MS, tamanhoJanelaMs: TAMANHO_JANELA_MS, regime: 'atualizacao' },
    ingerirAtualizacoesUC,
    eventosIngestaoStub,
  );

  const controller = new AbortController();
  schedulerPublicacao.iniciar(controller.signal);
  schedulerAtualizacao.iniciar(controller.signal);

  logger.info(
    'scheduler.iniciado',
    'PncpPollingScheduler iniciado (regimes publicacao+atualizacao, breaker PNCP, INGESTAO_SCHEDULER_ENABLED=true)',
  );

  return {
    teardown() {
      controller.abort();
      logger.info('scheduler.encerrado', 'PncpPollingScheduler encerrado');
    },
  };
}
