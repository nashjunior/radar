import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import { AcessoNegadoError } from '@radar/kernel';
import { AlertaNaoEncontradoError } from '../../domain/errors/index.js';
import { AlertaAberto } from '../events.js';
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
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: RegistrarAberturaInput, signal: AbortSignal): Promise<void> {
    const alerta = await this.alertas.porId(input.alertaId, signal);

    if (!alerta) throw new AlertaNaoEncontradoError(input.alertaId);

    if (alerta.clienteFinalId !== input.clienteFinalId) throw new AcessoNegadoError();

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
