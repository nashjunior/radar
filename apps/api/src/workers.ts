/**
 * Composition root dos workers assíncronos (P-96 §4) — cada bounded context
 * contribui seu worker aqui, gated por `WORKERS_ENABLED=true`. O worker de
 * Triagem (batch) precisa também de `ANTHROPIC_API_KEY`; os demais não.
 * P-74: único ponto do monólito que importa `@anthropic-ai/sdk` directamente.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ExtrairEditaisEmLoteUseCase,
  TriarEditalUseCase,
  type EventPublisher as TriagemEventPublisher,
  type ExtracaoRepository,
  type ObjectStorage,
  type PerfilGateway,
  type UsoLlmLedger,
} from '@radar/triagem';
import {
  AnthropicBatchLlmGateway,
  AnthropicLlmGateway,
  AnthropicSdkClient,
  TriagemBatchWorker,
  TriagemSolicitadaWorker,
  type MessageBatchesClient,
  type MessagesClient,
} from '@radar/triagem/infra';
import {
  ConfirmarUsoUseCase,
  LiberarReservaUseCase,
  type AssinaturaRepository,
  type EventPublisher,
  type IdProvider,
  type RegistroDeUsoRepository,
} from '@radar/cobranca';
import { CobrancaWorker } from '@radar/cobranca/infra';
import type { DocumentosDoEditalPort } from '@radar/ingestao';
import { RegistroDeUsoId, type EditalId } from '@radar/kernel';
import type { AnexosDTO } from '@radar/ingestao';
import { DocumentosEditalAclAdapter } from './infra/documentos-edital-acl-adapter.js';
import { triagemStub } from './infra/triagem-stub.js';
import { redigirParaLog } from './logging.js';

export interface WorkersHandle {
  /** `null` quando `ANTHROPIC_API_KEY` está ausente — só este worker depende dela. */
  worker: TriagemBatchWorker | null;
  /** `null` pela mesma razão de `worker`: `TriarEditalUseCase` também depende do `LlmGateway` (RAD-259). */
  triagemSolicitadaWorker: TriagemSolicitadaWorker | null;
  cobrancaWorker: CobrancaWorker;
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

/** Stub no-op de DlqClient — substituir por SqsDlqClient quando SQS provisionado. */
const dlqStub = {
  async encaminhar(msg: { editalId: string }, err: unknown): Promise<void> {
    console.error('[Workers][DLQ] edital descartado:', {
      editalId: msg.editalId,
      erro: redigirParaLog(err),
    });
  },
};

/** Stub no-op de PerfilGateway — substituir pelo ACL de Identidade & Organização (P-43) quando provisionado; retorna null (→ PerfilNaoEncontradoError) até lá. */
const perfilGatewayStub: PerfilGateway = {
  async porId(_id, _signal) {
    return null;
  },
};

/**
 * Stub no-op de EventPublisher da Triagem — substituir por `SqsEventPublisher` quando a fila
 * estiver provisionada. `TriagemConcluida`/`TriagemFalhou` publicados por `TriarEditalUseCase`
 * ficam sem consumidor real neste composition root até então (mesma realidade de `eventosStub`,
 * Cobrança) — o fechamento do loop RAD-255→RAD-247 é coberto por teste dedicado (RAD-259).
 */
const eventosTriagemStub: TriagemEventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};

/** Stub no-op de DlqClient de `triagem.solicitada` — substituir por SqsDlqClient quando SQS provisionado. */
const dlqTriagemSolicitadaStub = {
  async encaminhar(msg: { editalId: string }, err: unknown): Promise<void> {
    console.error('[Workers][DLQ] triagem.solicitada descartada:', {
      editalId: msg.editalId,
      erro: redigirParaLog(err),
    });
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

/** Stub no-op de EventPublisher — substituir por SqsEventPublisher quando a fila estiver provisionada. */
const eventosStub: EventPublisher = {
  async publicar(_evento, _signal) {
    /* stub */
  },
};

/** Stub no-op de DlqClient da Cobrança — substituir por SqsDlqClient quando SQS provisionado. */
const dlqCobrancaStub = {
  async encaminhar(msg: { tenantId: string }, err: unknown): Promise<void> {
    console.error('[Workers][DLQ] triagem.concluida descartada (Cobrança):', {
      tenantId: msg.tenantId,
      erro: redigirParaLog(err),
    });
  },
};

/**
 * Inicia os workers assíncronos — cada bounded context contribui o seu (P-96 §4).
 * Retorna `null` só se `WORKERS_ENABLED` estiver ausente/falso; a falta de
 * `ANTHROPIC_API_KEY` desliga apenas o worker de Triagem (`worker: null`), não o
 * de Cobrança (RAD-247), que não depende de LLM.
 */
export function iniciarWorkers(): WorkersHandle | null {
  if (process.env['WORKERS_ENABLED'] !== 'true') return null;

  const confirmarUsoUC = new ConfirmarUsoUseCase(assinaturasStub, registrosDeUsoStub, idsStub, eventosStub);
  const liberarReservaUC = new LiberarReservaUseCase(assinaturasStub);
  const cobrancaWorker = new CobrancaWorker(confirmarUsoUC, liberarReservaUC, dlqCobrancaStub);
  console.log('[Workers] CobrancaWorker iniciado (consumidor de triagem.concluida/triagem.falhou)');

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.warn('[Workers] ANTHROPIC_API_KEY ausente — TriagemBatchWorker/TriagemSolicitadaWorker não iniciados');
    return {
      worker: null,
      triagemSolicitadaWorker: null,
      cobrancaWorker,
      teardown() {
        console.log('[Workers] CobrancaWorker encerrado');
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

  const documentosGateway = new DocumentosEditalAclAdapter(documentosPortStub);

  const worker = new TriagemBatchWorker(extrairLoteUC, documentosGateway, objectStorageStub, dlqStub);

  console.log('[Workers] TriagemBatchWorker iniciado (ANTHROPIC_API_KEY presente)');

  // RAD-259: fecha o pré-requisito de RAD-257 — antes, `triagem.solicitada` não tinha consumidor.
  const llmGateway = new AnthropicLlmGateway(sdkClient);
  const triarEditalUC = new TriarEditalUseCase(
    extracaoStubWorkers,
    perfilGatewayStub,
    llmGateway,
    triagemStub,
    eventosTriagemStub,
    usoLedgerStub,
  );
  const triagemSolicitadaWorker = new TriagemSolicitadaWorker(
    triarEditalUC,
    documentosGateway,
    objectStorageStub,
    eventosTriagemStub,
    dlqTriagemSolicitadaStub,
  );
  console.log('[Workers] TriagemSolicitadaWorker iniciado (consumidor de triagem.solicitada → TriarEditalUseCase)');

  return {
    worker,
    triagemSolicitadaWorker,
    cobrancaWorker,
    teardown() {
      worker.teardown();
      console.log('[Workers] TriagemBatchWorker encerrado');
      console.log('[Workers] CobrancaWorker encerrado');
    },
  };
}
