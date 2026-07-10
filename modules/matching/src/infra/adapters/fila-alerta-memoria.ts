import type { AlertaParaGravarPayload, FilaAlertaPort } from '../../application/ports.js';

/**
 * Implementação em memória de FilaAlertaPort — usada em testes sem infra real (P-41/RAD-179).
 * Thread-safety não é necessária em Node.js single-thread; array é suficiente.
 */
export class FilaAlertaMemoria implements FilaAlertaPort {
  private readonly buffer: AlertaParaGravarPayload[] = [];

  async enfileirar(alerta: AlertaParaGravarPayload, _signal: AbortSignal): Promise<void> {
    this.buffer.push(alerta);
  }

  async drenar(limite: number, _signal: AbortSignal): Promise<AlertaParaGravarPayload[]> {
    return this.buffer.splice(0, limite);
  }

  get tamanho(): number {
    return this.buffer.length;
  }
}
