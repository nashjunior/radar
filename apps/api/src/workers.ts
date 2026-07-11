/**
 * Composition root dos workers assíncronos (P-96 §4).
 * Gated por `WORKERS_ENABLED=true` + `ANTHROPIC_API_KEY`.
 * P-74: único ponto do monólito que importa `@anthropic-ai/sdk` directamente.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ExtrairEditaisEmLoteUseCase,
  type ExtracaoRepository,
  type ObjectStorage,
  type UsoLlmLedger,
} from '@radar/triagem';
import {
  AnthropicBatchLlmGateway,
  AnthropicSdkClient,
  TriagemBatchWorker,
  type MessageBatchesClient,
  type MessagesClient,
} from '@radar/triagem/infra';
import type { DocumentosDoEditalPort } from '@radar/ingestao';
import type { EditalId } from '@radar/kernel';
import type { AnexosDTO } from '@radar/ingestao';
import { DocumentosEditalAclAdapter } from './infra/documentos-edital-acl-adapter.js';
import { redigirParaLog } from './logging.js';

export interface WorkersHandle {
  worker: TriagemBatchWorker;
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

/**
 * Inicia os workers assíncronos (acumulador de triagem).
 * Retorna null se `WORKERS_ENABLED` estiver ausente/falso ou `ANTHROPIC_API_KEY` não definida.
 */
export function iniciarWorkers(): WorkersHandle | null {
  if (process.env['WORKERS_ENABLED'] !== 'true') return null;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.warn('[Workers] ANTHROPIC_API_KEY ausente — workers não iniciados');
    return null;
  }

  const anthropic = new Anthropic({ apiKey });

  const sdkClient = new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient);
  void sdkClient; // wired via AnthropicLlmGateway no caminho síncrono; mantido p/ referência futura

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

  return {
    worker,
    teardown() {
      worker.teardown();
      console.log('[Workers] TriagemBatchWorker encerrado');
    },
  };
}
