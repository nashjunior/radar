import { CAP_DIGEST } from '../../domain/value-objects/frequencia.js';

export interface PoliticaAntiFadigaConfig {
  caps: Record<'DIARIA' | 'SEMANAL', number>;
}

/**
 * Lê a política anti-fadiga (P-81, docs/98) do ambiente para o composition root —
 * os dois números do cap viram config injetada, nunca literais espalhados pelo código;
 * mudança de política de Produto é mudança de config, não deploy de código novo.
 * O limiar de criticidade (prazo/aderência) não é config daqui: é decidido no domínio do
 * Matching (`Alerta.imediato`, P-81) e chega pronto no evento `alerta.gerado` — RAD-313.
 * Ausência de variável cai no default de P-81 (docs/11 §4).
 */
export function politicaAntiFadigaDoAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): PoliticaAntiFadigaConfig {
  return {
    caps: {
      DIARIA: numeroOuPadrao(env.RADAR_NOTIF_CAP_DIARIO, CAP_DIGEST.DIARIA),
      SEMANAL: numeroOuPadrao(env.RADAR_NOTIF_CAP_SEMANAL, CAP_DIGEST.SEMANAL),
    },
  };
}

function numeroOuPadrao(raw: string | undefined, padrao: number): number {
  if (raw === undefined || raw === '') return padrao;
  const valor = Number(raw);
  return Number.isFinite(valor) ? valor : padrao;
}
