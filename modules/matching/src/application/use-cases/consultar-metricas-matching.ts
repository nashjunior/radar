import type { TenantId } from '@radar/kernel';
import type { MetricasMatchingDTO } from '../dtos.js';
import type { MetricaMatchingRepository } from '../ports.js';

export interface ConsultarMetricasInput {
  tenantId: TenantId;
  /** Janela de ativação em dias. Default: 7 (docs/08 §3). */
  janelaEmDias?: number;
}

const PRECISAO_ALVO = 0.6;
const ATIVACAO_ALVO = 0.5;
const JANELA_DEFAULT_DIAS = 7;

/**
 * Retorna as métricas de qualidade do matching para um tenant.
 * Precisão (P-14): % de alertas marcados relevantes; alvo ≥60% e crescente (docs/08 §3).
 * Ativação (docs/08 §3): % de novos usuários com 1º alerta relevante em ≤7 dias; alvo ≥50%.
 * Gate P-21: apenas leitura — nenhum peso/limiar de matching é alterado aqui.
 */
export class ConsultarMetricasMatchingUseCase {
  constructor(private readonly metricas: MetricaMatchingRepository) {}

  async executar(
    input: ConsultarMetricasInput,
    signal: AbortSignal,
  ): Promise<MetricasMatchingDTO> {
    const janela = input.janelaEmDias ?? JANELA_DEFAULT_DIAS;

    const [precisaoRaw, ativacaoRaw] = await Promise.all([
      this.metricas.precisao(input.tenantId, signal),
      this.metricas.ativacao(input.tenantId, janela, signal),
    ]);

    const precisao =
      precisaoRaw.comFeedback > 0
        ? precisaoRaw.relevantes / precisaoRaw.comFeedback
        : null;

    const ativacao =
      ativacaoRaw.total > 0 ? ativacaoRaw.ativados / ativacaoRaw.total : null;

    return {
      precisao,
      precisaoAlvo: PRECISAO_ALVO,
      ativacao,
      ativacaoAlvo: ATIVACAO_ALVO,
      janelaEmDias: janela,
    };
  }
}
