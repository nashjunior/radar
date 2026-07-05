import { CanalIndisponivelError } from '../../domain/errors/index.js';
import type { Canal } from '../../domain/value-objects/canal.js';
import type { Notifier } from '../../application/ports.js';

interface SesClient {
  send(command: SendEmailCommand, opts?: { abortSignal?: AbortSignal }): Promise<void>;
}

interface SendEmailCommand {
  Source: string;
  Destination: { ToAddresses: string[] };
  Message: {
    Subject: { Data: string; Charset: string };
    Body: { Text: { Data: string; Charset: string } };
  };
}

/**
 * Adapter SES (ou SendGrid / Postmark — P-80 [A VALIDAR]) para o port Notifier.
 * No MVP apenas EMAIL é implementado.
 */
export class SesNotifier implements Notifier {
  constructor(
    private readonly ses: SesClient,
    private readonly remetente: string,
  ) {}

  async enviar(params: {
    canal: Canal;
    destinatario: string;
    assunto: string;
    corpo: string;
    signal: AbortSignal;
  }): Promise<void> {
    if (!params.canal.ehEmail)
      throw new CanalIndisponivelError(params.canal.tipo);

    try {
      await this.ses.send(
        {
          Source: this.remetente,
          Destination: { ToAddresses: [params.destinatario] },
          Message: {
            Subject: { Data: params.assunto, Charset: 'UTF-8' },
            Body: { Text: { Data: params.corpo, Charset: 'UTF-8' } },
          },
        },
        { abortSignal: params.signal },
      );
    } catch {
      // Falha de infra → CanalIndisponivelError; nunca vaza detalhe técnico (P-71)
      throw new CanalIndisponivelError('EMAIL');
    }
  }
}
