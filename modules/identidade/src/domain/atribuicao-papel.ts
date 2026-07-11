import type { ClienteFinalId, TenantId } from '@radar/kernel';
import type { Papel } from './papel.js';

declare const __brand: unique symbol;

/** Identificador do usuário — o `sub` verificado do IdP (Cognito), nunca gerado internamente. */
export type UsuarioId = string & { readonly [__brand]: 'UsuarioId' };
export const UsuarioId = (raw: string): UsuarioId => raw as UsuarioId;

export interface CriarAtribuicaoPapelProps {
  usuarioId: UsuarioId;
  tenantId: TenantId;
  papel: Papel;
  clienteFinalIds: readonly ClienteFinalId[];
}

/**
 * Atribuição de papel a um usuário (docs/14 §6, docs/05 §4 — P-52).
 * Dado de domínio de Identidade & Organização, nunca do token: revogar/reatribuir
 * papel vale sem novo login e a relação N:M operador↔clienteFinalId fica fora do JWT.
 * No Now a atribuição é semeada/provisionada — CRUD de usuários/papéis fica para depois.
 */
export class AtribuicaoPapel {
  private constructor(
    readonly usuarioId: UsuarioId,
    readonly tenantId: TenantId,
    readonly papel: Papel,
    readonly clienteFinalIds: readonly ClienteFinalId[],
  ) {}

  static criar(props: CriarAtribuicaoPapelProps): AtribuicaoPapel {
    return new AtribuicaoPapel(props.usuarioId, props.tenantId, props.papel, [...props.clienteFinalIds]);
  }
}
