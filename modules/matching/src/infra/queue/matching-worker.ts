import { DomainError, EditalId } from '@radar/kernel';
import type { EditalParaMatchingDTO } from '../../application/dtos.js';
import type { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';

/**
 * Contrato canônico de `edital.ingerido` (A03 §3, P-97).
 * Snapshot normalizado incluso — sem leitura cross-contexto do DB da Ingestão.
 */
interface EditalIngeridoMsg {
  editalId: string;
  objeto: string;
  orgaoUf: string;
  valorEstimado: number | null;
  dataPublicacao: string;
  modalidadeCodigo: number;
  /** Proveniência do edital — incluso desde RAD-115 (opcional para retro-compat). */
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
}

interface DlqClient {
  encaminhar(msg: { editalId: string }, err: unknown): Promise<void>;
}

/**
 * Consumidor da fila `edital.ingerido` para o contexto Matching (A14 §9).
 * DomainErrors esperados → DLQ imediato (retry não resolve).
 * Erros de infra → NACK (requeue/retry pelo broker).
 */
export class MatchingWorker {
  constructor(
    private readonly casarEditalUC: CasarEditalComCriteriosUseCase,
    private readonly dlq: DlqClient,
  ) {}

  async processar(msg: EditalIngeridoMsg, signal: AbortSignal): Promise<void> {
    const edital: EditalParaMatchingDTO = {
      id: EditalId(msg.editalId),
      tenantScope: 'global',
      modalidadeCodigo: msg.modalidadeCodigo,
      objetoDescricao: msg.objeto,
      uf: msg.orgaoUf || null,
      cnae: null,
      valorEstimado: msg.valorEstimado,
      dataPublicacao: new Date(msg.dataPublicacao),
      ...(msg.proveniencia !== undefined ? { proveniencia: msg.proveniencia } : {}),
    };

    try {
      await this.casarEditalUC.executar({ edital }, signal);
    } catch (err) {
      if (err instanceof DomainError) {
        await this.dlq.encaminhar({ editalId: msg.editalId }, err);
        return;
      }
      throw err;
    }
  }
}
