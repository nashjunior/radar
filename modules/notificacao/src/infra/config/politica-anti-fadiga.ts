import { LIMIARES_CRITICIDADE_PADRAO, type LimiaresCriticidade } from '../../domain/value-objects/criticidade.js';
import { CAP_DIGEST } from '../../domain/value-objects/frequencia.js';

export interface PoliticaAntiFadigaConfig {
  limiares: LimiaresCriticidade;
  caps: Record<'DIARIA' | 'SEMANAL', number>;
}

/**
 * Lê a política anti-fadiga (P-81, docs/98) do ambiente para o composition root —
 * os quatro números viram config injetada, nunca literais espalhados pelo código;
 * mudança de política de Produto é mudança de config, não deploy de código novo.
 * Ausência de variável cai no default de P-81 (docs/11 §4).
 */
export function politicaAntiFadigaDoAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): PoliticaAntiFadigaConfig {
  return {
    limiares: {
      diasAtePrazo: numeroOuPadrao(
        env.RADAR_NOTIF_CRITICO_DIAS,
        LIMIARES_CRITICIDADE_PADRAO.diasAtePrazo,
      ),
      aderencia: numeroOuPadrao(
        env.RADAR_NOTIF_CRITICO_ADERENCIA,
        LIMIARES_CRITICIDADE_PADRAO.aderencia,
      ),
    },
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
