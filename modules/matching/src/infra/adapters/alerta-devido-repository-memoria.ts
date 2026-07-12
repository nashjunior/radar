import type { AlertaId } from '@radar/kernel';
import type { AlertaDevidoRegistro, AlertaDevidoRepository } from '../../application/ports.js';

/** Implementação em memória de AlertaDevidoRepository — usada em testes sem infra real (P-114). */
export class AlertaDevidoRepositoryMemoria implements AlertaDevidoRepository {
  private readonly registros: AlertaDevidoRegistro[] = [];
  private readonly notificados = new Map<AlertaId, Date>();

  async registrarLote(devidos: AlertaDevidoRegistro[], _signal: AbortSignal): Promise<void> {
    this.registros.push(...devidos);
  }

  /** Idempotente — primeira chamada vence, reentregas não sobrescrevem (A18 §5.2). */
  async marcarNotificado(alertaId: AlertaId, notificadoEm: Date, _signal: AbortSignal): Promise<void> {
    if (!this.notificados.has(alertaId)) this.notificados.set(alertaId, notificadoEm);
  }

  get todos(): AlertaDevidoRegistro[] {
    return this.registros.slice();
  }

  notificadoEm(alertaId: AlertaId): Date | undefined {
    return this.notificados.get(alertaId);
  }
}
