/**
 * Guardrail de custo — admission control + orçamento acumulado por janela (RAD-243, P-20/P-38,
 * veredicto de arquitetura RAD-227: docs/98 P-20). Terceira peça do trio de RAD-227/RAD-230: a
 * medição (RAD-230) já existe (`UsoLlmLedger`/`registro_uso_llm`); esta é a IMPOSIÇÃO.
 *
 * Duas checagens independentes, ambas ANTES da chamada paga ao LLM (zero custo se rejeitar):
 *   1. Teto de admissão por item — sanity ceiling contra OUTLIERS (OCR corrompido, texto
 *      degenerado), não o orçamento de negócio. Um edital normal nunca chega perto disso (os
 *      modelos atuais — Sonnet 5/Opus 4.8 — têm 1M de contexto; ver RAD-243/claude-api skill).
 *   2. Orçamento acumulado por janela — gasto já realizado + custo ESTIMADO desta chamada (pior
 *      caso de output) não pode exceder o teto (global sempre; por tenant quando configurado).
 *      "Não é hard ceiling por item" (docs/98 P-20): o item mais caro do tier Opus já estouraria
 *      qualquer teto fixo baixo — por isso o teto é sobre o ACUMULADO na janela, não por chamada.
 */
/**
 * Teto de sanidade contra outliers no INPUT (não é o orçamento de negócio — ver `PoliticaOrcamento`
 * abaixo). 200k tokens é generoso: bem acima de qualquer edital+anexos real, mas uma fração pequena
 * do contexto de 1M dos modelos atuais — protege contra texto degenerado (loop de OCR, PDF corrompido),
 * não contra editais grandes legítimos. Reavaliar se P-93 (tiers de modelo) trouxer Haiku 4.5 (200k de
 * contexto) para a extração — hoje `escolherModelo()` só alterna Sonnet/Opus (ambos 1M).
 */
export const MAX_INPUT_TOKENS_ADMISSAO = 200_000;

/**
 * Orçamento de custo acumulado por janela. O NÚMERO em USD é `[A VALIDAR]` (Negócio+Eng, docs/98
 * P-20) — por isso o default (`POLITICA_ORCAMENTO_PADRAO`) não tem teto (kill-switch nunca aciona
 * até a composição-root injetar valores reais). A ESTRUTURA não precisa esperar o número fechar
 * (mesmo padrão de `LIMIAR_CONFIANCA_PADRAO`, P-19): compor o parâmetro agora, recalibrar depois.
 */
export interface PoliticaOrcamento {
  /** Tamanho da janela deslizante (rolling), em horas. */
  readonly janelaHoras: number;
  /** Teto USD acumulado na janela, escopo GLOBAL (soma todas as chamadas, com ou sem tenant). */
  readonly orcamentoGlobalUsd: number;
  /** Teto USD acumulado na janela, POR TENANT. `null` = sem teto por tenant (ex.: pré-extração global, sem tenant a checar). */
  readonly orcamentoPorTenantUsd: number | null;
}

/** Default sem teto — kill-switch inerte até Negócio+Eng ratificarem o número (docs/98 P-20). */
export const POLITICA_ORCAMENTO_PADRAO: PoliticaOrcamento = {
  janelaHoras: 24,
  orcamentoGlobalUsd: Number.POSITIVE_INFINITY,
  orcamentoPorTenantUsd: null,
};

/**
 * Teto de admissão (sanity ceiling contra outliers) — checagem 1, independente do orçamento em USD.
 * Duas funções pequenas (em vez de uma combinada) para o use case saber QUAL erro lançar
 * (`EntradaExcedeTetoDeAdmissaoError` vs `OrcamentoDeCustoExcedidoError`) sem inspecionar motivo.
 */
export function excedeTetoDeAdmissao(inputTokens: number): boolean {
  return inputTokens > MAX_INPUT_TOKENS_ADMISSAO;
}

/**
 * Orçamento acumulado por janela — checagem 2: gasto já feito + custo ESTIMADO desta chamada
 * (pior caso de output) excederia o teto do escopo (global ou por tenant).
 */
export function excedeOrcamento(custoEstimadoUsd: number, gastoAtualUsd: number, tetoUsd: number): boolean {
  return gastoAtualUsd + custoEstimadoUsd > tetoUsd;
}

/** Início da janela deslizante a partir de `agora` — extraído para não espalhar a aritmética de ms. */
export function inicioDaJanela(agora: Date, politica: PoliticaOrcamento): Date {
  return new Date(agora.getTime() - politica.janelaHoras * 3_600_000);
}
