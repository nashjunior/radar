import { AlertaId, ClienteFinalId, DomainError, TenantId } from '@radar/kernel';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import type { NotificarAlertaUseCase } from '../../application/use-cases/notificar-alerta.js';

/** Contrato canônico de `alerta.gerado` (A03 §3). Sem usuarioId nem emailDestinatario — resolução é da Notificação. */
interface AlertaGeradoMsg {
  alertaId: string;
  tenantId: string;
  clienteFinalId: string;
  /** `occurredAt` (ISO-8601) do envelope da mensagem `alerta.gerado` (A18 §5). */
  alertaGeradoEm: string;
  /** Decidido pelo Matching (`Alerta.imediato`, P-81) — Notificação consome, não recalcula (RAD-313). */
  imediato: boolean;
}

interface DlqClient {
  encaminhar(msg: AlertaGeradoMsg, err: unknown): Promise<void>;
}

/**
 * Consumidor da fila `alerta.gerado` (A14 §9).
 * CanalIndisponivelError → NACK (retry até 3×, depois DLQ).
 * Outros DomainErrors → DLQ imediato (retry não resolve).
 */
export class NotificacaoWorker {
  constructor(
    private readonly notificarAlertaUC: NotificarAlertaUseCase,
    private readonly dlq: DlqClient,
  ) {}

  async processar(msg: AlertaGeradoMsg, signal: AbortSignal): Promise<void> {
    try {
      await this.notificarAlertaUC.executar(
        {
          alertaId: AlertaId(msg.alertaId),
          tenantId: TenantId(msg.tenantId),
          clienteFinalId: ClienteFinalId(msg.clienteFinalId),
          alertaGeradoEm: new Date(msg.alertaGeradoEm),
          imediato: msg.imediato,
        },
        signal,
      );
    } catch (err) {
      if (err instanceof CanalIndisponivelError) {
        throw err;
      }
      if (err instanceof DomainError) {
        await this.dlq.encaminhar(msg, err);
        return;
      }
      throw err;
    }
  }
}
