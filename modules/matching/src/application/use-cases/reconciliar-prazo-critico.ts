import { AlertaPrazoCriticoReconciliado } from '../events.js';
import { DIAS_ATE_PRAZO_CRITICO_PADRAO } from '../../domain/value-objects/prazo-critico.js';
import type { PrazoCriticoReconciliacaoDTO } from '../dtos.js';
import type { ClockProvider, CoberturaPrazoCriticoRepository, EventPublisher } from '../ports.js';

export interface ReconciliarPrazoCriticoInput {
  /** Corte de dias corridos até o prazo (P-81). Default: 3 (docs/08 §4.1). */
  diasLimiar?: number;
}

/**
 * Varre os editais elegíveis da janela de prazo crítico e mede o déficit de cobertura
 * (docs/08 §4.1, A18 §5.1) — o SLO de error budget ZERO "0 alertas de prazo crítico
 * perdidos". `perdido` é um NÃO-evento: não existe contador de incremento para "alerta
 * que deveria ter sido gerado e não foi"; este ciclo É a única forma de enxergá-lo.
 * Trigger: scheduler periódico (A18 §5.1) — nunca o caminho síncrono da API.
 * `perdido >= 1` publicado no evento é o gatilho de severidade máxima (RCA + replay,
 * P-35/P-36) — o alarme sobre esta métrica é escopo da RAD-304.
 */
export class ReconciliarPrazoCriticoUseCase {
  constructor(
    private readonly cobertura: CoberturaPrazoCriticoRepository,
    private readonly eventos: EventPublisher,
    private readonly clock: ClockProvider,
  ) {}

  async executar(
    input: ReconciliarPrazoCriticoInput,
    signal: AbortSignal,
  ): Promise<PrazoCriticoReconciliacaoDTO> {
    const diasLimiar = input.diasLimiar ?? DIAS_ATE_PRAZO_CRITICO_PADRAO;
    const agora = this.clock.agora();

    const { elegivel, coberto } = await this.cobertura.contar({ agora, diasLimiar }, signal);
    const perdido = elegivel - coberto;

    await this.eventos.publicar(
      new AlertaPrazoCriticoReconciliado({ elegivel, coberto, perdido }),
      signal,
    );

    return { elegivel, coberto, perdido };
  }
}
