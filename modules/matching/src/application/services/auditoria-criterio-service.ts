import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type { AuditCriterioEntrada, AuditCriterioPort } from '../ports.js';

/**
 * Auditoria fail-closed de operações sobre CRITERIO_MONITORAMENTO (AB13/P-61, docs/05 §9).
 * Usado por `ConsultarCriteriosTenantUseCase` (leitura) e `DefinirCriterioMonitoramentoUseCase`
 * (escrita) — ambos precisam do mesmo wrap "audita ou bloqueia a operação".
 */
export class AuditoriaCriterioService {
  constructor(private readonly audit: AuditCriterioPort) {}

  async registrarFailClosed(entrada: AuditCriterioEntrada, signal: AbortSignal): Promise<void> {
    try {
      await this.audit.registrar(entrada, signal);
    } catch {
      throw new AuditoriaIndisponivelError();
    }
  }
}
