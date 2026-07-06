import { EditalId } from '@radar/kernel';
import type {
  DocumentosEditalGateway,
  ObjectStorage,
} from '../../application/ports.js';
import type { ExtrairEditaisEmLoteUseCase } from '../../application/use-cases/extrair-editais-lote.js';
import type { ExtrairEditalLoteItem } from '../../application/use-cases/extrair-editais-lote.js';

/**
 * Contrato canônico de `edital.ingerido` (A03 §3, enriquecido por RAD-95/P-97).
 * Snapshot de atributos normalizados + identidade; texto/docs via DocumentosEditalGateway.
 */
export interface EditalIngeridoMsg {
  editalId: string;
  objeto: string;
  orgaoUf: string;
  valorEstimado: number | null;
  dataPublicacao: string;
  modalidadeCodigo: number;
}

interface DlqClient {
  encaminhar(msg: { editalId: string }, err: unknown): Promise<void>;
}

export interface TriagemBatchWorkerOpts {
  /** Máximo de itens por lote antes de forçar flush (default: 10). */
  readonly tamanhoBatch?: number;
  /** Segundos de janela de acumulação antes de flush automático (default: 30). */
  readonly janelaMs?: number;
}

/**
 * Consumidor de `edital.ingerido` para pré-extração em lote (RAD-54 · Lever 1, RAD-53).
 * Acumula mensagens, hidrata cada edital via DocumentosEditalGateway + ObjectStorage,
 * e chama ExtrairEditaisEmLoteUseCase no flush (por tamanho ou tempo).
 * P-45: cache-hit por edital impede re-chamadas ao LLM; idempotente sob reprocesso.
 * Smoke credenciado (item 4 de RAD-59): gated por ANTHROPIC_API_KEY no composition root.
 */
export class TriagemBatchWorker {
  private readonly tamanhoBatch: number;
  private readonly janelaMs: number;
  private readonly buffer: { msg: EditalIngeridoMsg; signal: AbortSignal }[] = [];
  private timerFlush: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly extrairLoteUC: ExtrairEditaisEmLoteUseCase,
    private readonly documentosGateway: DocumentosEditalGateway,
    private readonly storage: ObjectStorage,
    private readonly dlq: DlqClient,
    opts: TriagemBatchWorkerOpts = {},
  ) {
    this.tamanhoBatch = opts.tamanhoBatch ?? 10;
    this.janelaMs = opts.janelaMs ?? 30_000;
  }

  /**
   * Recebe uma mensagem da fila e a acumula no buffer.
   * Flush imediato se o buffer atingir o tamanho máximo.
   */
  async enfileirar(msg: EditalIngeridoMsg, signal: AbortSignal): Promise<void> {
    this.buffer.push({ msg, signal });
    this.agendarFlushAutomatico();
    if (this.buffer.length >= this.tamanhoBatch) {
      await this.flush();
    }
  }

  /**
   * Força o flush do buffer atual, mesmo se incompleto.
   * Chamado pelo timer de janela ou pelo shutdown gracioso.
   */
  async flush(): Promise<void> {
    this.cancelarTimerFlush();
    if (this.buffer.length === 0) return;

    const lote = this.buffer.splice(0, this.buffer.length);
    const batchSignal = lote[0]?.signal ?? new AbortController().signal;

    const itens: ExtrairEditalLoteItem[] = [];
    for (const { msg, signal } of lote) {
      try {
        const item = await this.hidratar(msg, signal);
        if (item) itens.push(item);
      } catch (err) {
        await this.dlq.encaminhar({ editalId: msg.editalId }, err);
      }
    }

    if (itens.length === 0) return;

    try {
      await this.extrairLoteUC.executar(itens, batchSignal);
    } catch (err) {
      // Erro fatal do lote — loga sem crashar o worker; cada item foi tentado
      console.error('[TriagemBatchWorker] erro ao executar lote:', err);
    }
  }

  /** Fecha o timer de flush automático (shutdown gracioso). */
  teardown(): void {
    this.cancelarTimerFlush();
  }

  private async hidratar(
    msg: EditalIngeridoMsg,
    signal: AbortSignal,
  ): Promise<ExtrairEditalLoteItem | null> {
    const editalId = EditalId(msg.editalId);
    const docs = await this.documentosGateway.obterRefs(editalId, signal);

    if (docs.arquivos.length === 0) {
      // Edital sem documentos → ignora (leitura manual; piso de OCR docs/10 §6)
      return null;
    }

    const storageKeys = docs.arquivos.map((a) => a.storageKey);

    // Lê texto do primeiro documento (edital principal) + demais como anexos
    const textoPrincipal = await this.storage
      .obterTextoAnexo(storageKeys[0]!, signal)
      .catch(() => '');

    return {
      editalId,
      texto: textoPrincipal,
      temTextoSelecionavel: textoPrincipal.trim().length > 0,
      // Todos os storageKeys = refs de anexos para ExtrairEditaisEmLoteUseCase
      anexosRefs: storageKeys,
      // Número de páginas desconhecido no MVP; piso de 1 (docs/10 §6 — estimativa segura)
      paginas: 1,
    };
  }

  private agendarFlushAutomatico(): void {
    if (this.timerFlush !== null) return;
    this.timerFlush = setTimeout(() => {
      this.timerFlush = null;
      this.flush().catch((err) => {
        console.error('[TriagemBatchWorker] erro no flush automático:', err);
      });
    }, this.janelaMs);
  }

  private cancelarTimerFlush(): void {
    if (this.timerFlush !== null) {
      clearTimeout(this.timerFlush);
      this.timerFlush = null;
    }
  }
}
