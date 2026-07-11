import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import { FeedbackAlerta } from '../events.js';
import { AlertaAutorizacaoService } from '../services/alerta-autorizacao-service.js';
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
  private readonly autorizacao: AlertaAutorizacaoService;

  constructor(
    private readonly alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
  ) {
    this.autorizacao = new AlertaAutorizacaoService(alertas);
  }

  async executar(
    input: RegistrarFeedbackInput,
    signal: AbortSignal,
  ): Promise<void> {
    const alerta = await this.autorizacao.carregarEAutorizar(
      input.alertaId,
      input.clienteFinalId,
      signal,
    );

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
