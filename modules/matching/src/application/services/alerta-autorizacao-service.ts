import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import { AcessoNegadoError } from '@radar/kernel';
import type { Alerta } from '../../domain/entities/alerta.js';
import { AlertaNaoEncontradoError } from '../../domain/errors/index.js';
import type { AlertaRepository } from '../ports.js';

/**
 * Carrega um alerta e verifica autorização por objeto (P-51/AB1 — defesa de IDOR).
 * Usado por `RegistrarAberturaAlertaUseCase` e `RegistrarFeedbackAlertaUseCase`, que
 * precisam da mesma checagem antes de qualquer mutação sobre o alerta.
 */
export class AlertaAutorizacaoService {
  constructor(private readonly alertas: AlertaRepository) {}

  async carregarEAutorizar(
    alertaId: AlertaId,
    clienteFinalId: ClienteFinalId,
    signal: AbortSignal,
  ): Promise<Alerta> {
    const alerta = await this.alertas.porId(alertaId, signal);
    if (!alerta) throw new AlertaNaoEncontradoError(alertaId);
    if (alerta.clienteFinalId !== clienteFinalId) throw new AcessoNegadoError();
    return alerta;
  }
}
