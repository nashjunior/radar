/** Papéis do usuário — definidos em docs/05 §4 (P-52). */
export type Papel =
  | 'ADMIN_CONSULTORIA'
  | 'OPERADOR'
  | 'CLIENTE_FINAL_READONLY'
  | 'DPO_COMPLIANCE';

/** Dados de sessão retornados por GET /api/me. */
export interface SessaoUsuario {
  usuarioId: string;
  tenantId: string;
  papel: Papel;
  clienteFinalIds: string[];
}
