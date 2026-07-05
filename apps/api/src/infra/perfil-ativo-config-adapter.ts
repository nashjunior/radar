/**
 * Adapter MVP de PerfilAtivoGateway (P-90) — backed em config/seed.
 *
 * Enquanto o módulo Identidade & Organização não existe, a resolução
 * tenant→{clienteFinal,perfil} vem de uma variável de ambiente
 * TENANT_SEED (JSON). Quando o módulo vier, troca-se só este adapter —
 * o port não muda.
 *
 * Formato de TENANT_SEED:
 *   { "<tenantId>": { "clienteFinalId": "...", "perfilId": "..." }, ... }
 *
 * Nunca hardcode valores — provisionado junto do tenant (env/config file).
 * AbortSignal propagado (P-78); lookup síncrono não I/O, mas checamos
 * o abort antes de retornar.
 *
 * Refs: docs/98 P-90, arquitetura/17 §4.3.
 */

import { ClienteFinalId, PerfilId } from '@radar/kernel';
import type { TenantId } from '@radar/kernel';
import type { PerfilAtivoGateway } from '../ports/perfil-ativo-gateway.js';

type EntradaSeed = { clienteFinalId: string; perfilId: string };
type MapaInterno = ReadonlyMap<string, { clienteFinalId: ClienteFinalId; perfilId: PerfilId }>;

export class PerfilAtivoConfigAdapter implements PerfilAtivoGateway {
  private readonly mapa: MapaInterno;

  constructor(mapa: MapaInterno) {
    this.mapa = mapa;
  }

  /**
   * Constrói o adapter a partir de um JSON string (tipicamente de env).
   * Lança Error com mensagem descritiva se o JSON for inválido.
   */
  static fromJson(json: string): PerfilAtivoConfigAdapter {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error('TENANT_SEED: JSON inválido.');
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('TENANT_SEED: deve ser um objeto JSON { tenantId: { clienteFinalId, perfilId } }.');
    }

    const mapa = new Map<string, { clienteFinalId: ClienteFinalId; perfilId: PerfilId }>();
    for (const [tenantId, entrada] of Object.entries(raw as Record<string, unknown>)) {
      if (
        typeof entrada !== 'object' ||
        entrada === null ||
        typeof (entrada as EntradaSeed).clienteFinalId !== 'string' ||
        typeof (entrada as EntradaSeed).perfilId !== 'string' ||
        (entrada as EntradaSeed).clienteFinalId.trim() === '' ||
        (entrada as EntradaSeed).perfilId.trim() === ''
      ) {
        throw new Error(
          `TENANT_SEED: entrada inválida para tenant "${tenantId}". Esperado { clienteFinalId: string, perfilId: string }.`,
        );
      }
      const e = entrada as EntradaSeed;
      mapa.set(tenantId, {
        clienteFinalId: ClienteFinalId(e.clienteFinalId),
        perfilId: PerfilId(e.perfilId),
      });
    }

    return new PerfilAtivoConfigAdapter(mapa);
  }

  async resolverParaTenant(
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<{ clienteFinalId: ClienteFinalId; perfilId: PerfilId } | null> {
    signal.throwIfAborted();
    return this.mapa.get(tenantId) ?? null;
  }
}
