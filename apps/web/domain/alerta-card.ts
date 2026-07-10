/**
 * Vista combinada de alerta + resumo do edital — alimentada por AlertasApiGateway (RAD-147).
 * Shape de GET /api/alertas (endpoint live desde RAD-148).
 * Campos de catálogo (modalidade, titulo, orgao, valorEstimado, dataAbertura) são null quando o
 * edital não for encontrado no Catálogo (catalog miss — comportamento definido em RAD-148).
 */
export interface AlertaCardItem {
  readonly alertaId: string;
  readonly editalId: string;
  readonly modalidade: string;
  readonly titulo: string;
  readonly orgao: string;
  readonly valorEstimado: number | null;
  /** ISO 8601 — data/hora de abertura do edital. null quando catalog miss (edital não no Catálogo). */
  readonly dataAbertura: string | null;
  /** Percentual de aderência 0–100. */
  readonly aderencia: number;
  readonly relevante: boolean | null;
  readonly proveniencia?: {
    readonly fonte: string;
    readonly dataColeta: string;
    readonly baseLegal: string;
  };
}
