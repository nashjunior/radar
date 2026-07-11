/**
 * Papel do usuário no sistema (P-52, docs/05 §4). União fechada, atribuída
 * neste contexto (Identidade & Organização) — nunca lida do token OIDC
 * (docs/14 §6): revogar/reatribuir papel vale sem novo login.
 */
export type Papel = 'ADMIN_CONSULTORIA' | 'OPERADOR' | 'CLIENTE_FINAL_READONLY' | 'DPO_COMPLIANCE';
