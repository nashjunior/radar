import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import { AcessoNegadoError } from '@radar/kernel';
import { AlertaNaoEncontradoError } from '../../domain/errors/index.js';
import { FeedbackAlerta } from '../events.js';
import type { AlertaRepository, EventPublisher } from '../ports.js';

export interface RegistrarFeedbackInput {
  alertaId: AlertaId;
  relevante: boolean;
  /** Para autorização por objeto — defesa de IDOR (P-51 / AB1). */
  clienteFinalId: ClienteFinalId;
}

/**
 * Registra o feedback do usuário em um alerta (relevante/irrelevante).
 * Autorização POR OBJETO (P-51): verifica que o alerta pertence ao clienteFinal
 * antes de qualquer mutação — defesa de IDOR/BOLA, vetor nº1 de vazamento cross-tenant.
 */
export class RegistrarFeedbackAlertaUseCase {
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(
    input: RegistrarFeedbackInput,
    signal: AbortSignal,
  ): Promise<void> {
    const alerta = await this.alertas.porId(input.alertaId, signal);

    if (!alerta) throw new AlertaNaoEncontradoError(input.alertaId);

    if (alerta.clienteFinalId !== input.clienteFinalId) throw new AcessoNegadoError();

    const alertaAtualizado = alerta.comFeedback(input.relevante);

    await this.alertas.atualizarFeedback(alertaAtualizado.id, input.relevante, signal);

    await this.eventos.publicar(
      new FeedbackAlerta({
        alertaId: alertaAtualizado.id,
        relevante: input.relevante,
      }),
      signal,
    );
  }
}
