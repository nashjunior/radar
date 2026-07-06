import { DomainError, EditalId } from '@radar/kernel';
import type { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';

/** Contrato canônico de `edital.ingerido` (A03 §3). ACL — sem vazar modelo do PNCP. */
interface EditalIngeridoMsg {
  editalId: string;
}

interface DlqClient {
  encaminhar(msg: EditalIngeridoMsg, err: unknown): Promise<void>;
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
    try {
      await this.casarEditalUC.executar({ editalId: EditalId(msg.editalId) }, signal);
    } catch (err) {
      if (err instanceof DomainError) {
        await this.dlq.encaminhar(msg, err);
        return;
      }
      throw err;
    }
  }
}
