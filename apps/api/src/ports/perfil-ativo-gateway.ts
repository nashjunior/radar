/**
 * Port BFF: resolve o perfil ativo do tenant (seam P-90).
 *
 * Fronteira DDD: seleção de perfil ativo pertence ao contexto
 * Identidade & Organização, exposto na borda pelo BFF — não é do
 * módulo Triagem (aquele tem PerfilGateway/P-83 apenas para porId).
 *
 * Retorna null quando o tenant é desconhecido → rota mapeia para
 * 401/404, nunca vazando o motivo (A17 §5.3).
 *
 * MVP single-tenant (P-25): 1 tenantId → 1 clienteFinalId → 1 perfilId.
 * Multi-perfil por cliente adiado ao Next (P-49).
 *
 * Refs: docs/98 P-90, arquitetura/17 §4.3.
 */

import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';

export interface PerfilAtivoGateway {
  resolverParaTenant(
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<{ clienteFinalId: ClienteFinalId; perfilId: PerfilId } | null>;
}
