import { iniciarAgendadorAbortavel } from '@radar/kernel';
import type { ReconciliarPrazoCriticoUseCase } from '../../application/use-cases/reconciliar-prazo-critico.js';
import type { PrazoCriticoReconciliacaoDTO } from '../../application/dtos.js';

// ---------------------------------------------------------------------------
// Cadência do reconciliador — arquitetura/18 §5.1(3)/§6 só diz "job periódico", sem número.
// ---------------------------------------------------------------------------
// O SLO tem error budget ZERO ("0 alertas de prazo crítico perdidos"), então a cadência é o
// tempo até detecção de `perdido >= 1` — não um custo a minimizar. `contar()` é uma leitura
// agregada local (P-114, sem cross-schema), barata o bastante para rodar bem mais frequente
// que a janela de 3 dias (P-81) que ela varre. Valor conservador de partida: 15 min — folga
// grande para o alarme de severidade máxima (RCA + replay, P-35/P-36) disparar cedo. Ajustável
// por config (não hardcoded), mesmo princípio de PncpPollingSchedulerConfig.intervaloMs (P-29).
export const INTERVALO_RECONCILIADOR_PRAZO_CRITICO_MS_PADRAO = 15 * 60 * 1000;

export interface ReconciliadorPrazoCriticoSchedulerConfig {
  /** Intervalo entre ciclos em ms. Padrão recomendado: 15 min (ver constante acima). */
  intervaloMs: number;
  /** Corte de dias corridos até o prazo (P-81). Default do use case: 3 (docs/08 §4.1). */
  diasLimiar?: number;
  aoFalhar?: (erro: unknown) => void;
}

type UseCase = Pick<ReconciliarPrazoCriticoUseCase, 'executar'>;

/**
 * Scheduler do reconciliador de prazo crítico para o composition root do Matching.
 * Trigger exclusivo do `ReconciliarPrazoCriticoUseCase` (arq/18 §5.1(3)) — o use case já
 * documenta "nunca o caminho síncrono da API"; este scheduler é o único chamador em produção.
 */
export class ReconciliadorPrazoCriticoScheduler {
  constructor(
    private readonly reconciliar: UseCase,
    private readonly config: ReconciliadorPrazoCriticoSchedulerConfig,
  ) {
    if (!Number.isFinite(config.intervaloMs) || config.intervaloMs <= 0) {
      throw new RangeError('intervaloMs deve ser > 0 e finito');
    }
  }

  async executarCiclo(signal: AbortSignal): Promise<PrazoCriticoReconciliacaoDTO> {
    const input = this.config.diasLimiar === undefined ? {} : { diasLimiar: this.config.diasLimiar };
    return this.reconciliar.executar(input, signal);
  }

  iniciar(signal: AbortSignal): () => void {
    return iniciarAgendadorAbortavel(
      s => this.executarCiclo(s),
      { intervaloMs: this.config.intervaloMs, aoFalhar: this.config.aoFalhar },
      signal,
    );
  }
}
