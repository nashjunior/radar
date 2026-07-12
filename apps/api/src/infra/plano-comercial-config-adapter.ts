/**
 * Catálogo de planos comerciais (RAD-264) — backed em config/seed, mesmo padrão de
 * `PerfilAtivoConfigAdapter` (P-90): sem tela de administração de planos ainda, o
 * catálogo vem de `PLANOS_COMERCIAIS_SEED` (JSON). Preços `[A VALIDAR]` (docs/09
 * §6.1, P-107 (a)/(b)) — nunca hardcode no código.
 */

import { PlanoComercial } from '@radar/cobranca';
import type { PlanoComercialCatalogo } from '@radar/cobranca';

type EntradaPlanoSeed = { cotaTriagensMes: number; precoCentavos: number };

export class PlanoComercialConfigAdapter implements PlanoComercialCatalogo {
  private constructor(private readonly mapa: ReadonlyMap<string, PlanoComercial>) {}

  static fromJson(json: string): PlanoComercialConfigAdapter {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error('PLANOS_COMERCIAIS_SEED: JSON inválido.');
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(
        'PLANOS_COMERCIAIS_SEED: deve ser um objeto JSON { codigo: { cotaTriagensMes, precoCentavos } }.',
      );
    }

    const mapa = new Map<string, PlanoComercial>();
    for (const [codigo, entrada] of Object.entries(raw as Record<string, unknown>)) {
      const e = entrada as Partial<EntradaPlanoSeed>;
      if (typeof e?.cotaTriagensMes !== 'number' || typeof e?.precoCentavos !== 'number') {
        throw new Error(
          `PLANOS_COMERCIAIS_SEED: entrada inválida para plano "${codigo}". Esperado { cotaTriagensMes: number, precoCentavos: number }.`,
        );
      }
      mapa.set(
        codigo,
        PlanoComercial.criar({ codigo, cotaTriagensMes: e.cotaTriagensMes, precoCentavos: e.precoCentavos }),
      );
    }

    return new PlanoComercialConfigAdapter(mapa);
  }

  async porCodigo(codigo: string, signal: AbortSignal): Promise<PlanoComercial | null> {
    signal.throwIfAborted();
    return this.mapa.get(codigo) ?? null;
  }
}
