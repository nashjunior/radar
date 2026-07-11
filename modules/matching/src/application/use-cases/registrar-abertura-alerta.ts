import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import { AlertaAberto } from '../events.js';
import { AlertaAutorizacaoService } from '../services/alerta-autorizacao-service.js';
import type { AlertaRepository, EventPublisher } from '../ports.js';

export interface RegistrarAberturaInput {
  alertaId: AlertaId;
  /** Para autorização por objeto — defesa de IDOR (P-51 / AB1). */
  clienteFinalId: ClienteFinalId;
}

/**
 * Registra a abertura de um alerta pelo usuário e emite alerta.aberto.
 * Alimenta o funil de ativação e precisão (P-15, docs/08 §3).
 * Autorização POR OBJETO (P-51): verifica titularidade antes de emitir o evento.
 */
export class RegistrarAberturaAlertaUseCase {
  private readonly autorizacao: AlertaAutorizacaoService;

  constructor(
    alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
  ) {
    this.autorizacao = new AlertaAutorizacaoService(alertas);
  }

  async executar(input: RegistrarAberturaInput, signal: AbortSignal): Promise<void> {
    const alerta = await this.autorizacao.carregarEAutorizar(
      input.alertaId,
      input.clienteFinalId,
      signal,
    );

    await this.eventos.publicar(
      new AlertaAberto({
        alertaId: alerta.id,
        tenantId: alerta.tenantId,
        clienteFinalId: alerta.clienteFinalId,
      }),
      signal,
    );
  }
}
