import type { CanalTipo } from '@radar/notificacao';
import type { Notifier } from '@radar/notificacao';
import type { Canal } from '@radar/notificacao';

export interface NotificacaoCapturada {
  canal: CanalTipo;
  destinatario: string;
  assunto: string;
  corpo: string;
}

/**
 * Notifier que captura envios em memória — nunca dispara SES real (A04 §4).
 */
export class CaptureNotifier implements Notifier {
  readonly enviadas: NotificacaoCapturada[] = [];
  private shouldFail = false;

  simularFalha(value = true): void {
    this.shouldFail = value;
  }

  async enviar(params: {
    canal: Canal;
    destinatario: string;
    assunto: string;
    corpo: string;
    signal: AbortSignal;
  }): Promise<void> {
    if (this.shouldFail) throw new Error('canal indisponível (simulado)');

    this.enviadas.push({
      canal: params.canal.tipo,
      destinatario: params.destinatario,
      assunto: params.assunto,
      corpo: params.corpo,
    });
  }

  reset(): void {
    this.enviadas.length = 0;
    this.shouldFail = false;
  }
}
