import type { Papel } from './papel.js';

export type Recurso =
  | 'USUARIO_PAPEL'
  | 'CRITERIO_MONITORAMENTO'
  | 'ALERTA'
  | 'TRIAGEM'
  | 'PERFIL_HABILITACAO'
  | 'PREFERENCIA_NOTIFICACAO'
  | 'AUDIT_LOG'
  | 'SOLICITACAO_TITULAR';

export type Acao = 'ler' | 'criar' | 'editar' | 'decidir' | 'gerenciar';

/**
 * Matriz recurso × ação por papel (docs/05 §4, "matriz mínima de permissões").
 * Deny by default: combinação ausente aqui é sempre negada por `podeExecutar`.
 * Isto responde só "este papel pode tentar esta ação" — a autorização por
 * objeto (P-51/AB1, escopo tenantId/clienteFinalId) é controle separado e
 * cumulativo, feito em AutorizarAcessoUseCase e em cada use case dono.
 */
const MATRIZ: Record<Papel, Partial<Record<Recurso, readonly Acao[]>>> = {
  ADMIN_CONSULTORIA: {
    USUARIO_PAPEL: ['gerenciar'],
    CRITERIO_MONITORAMENTO: ['ler', 'criar', 'editar'],
    ALERTA: ['ler', 'decidir'],
    TRIAGEM: ['ler', 'criar', 'decidir'],
    PERFIL_HABILITACAO: ['ler', 'editar'],
    PREFERENCIA_NOTIFICACAO: ['editar'],
    AUDIT_LOG: ['ler'],
  },
  OPERADOR: {
    CRITERIO_MONITORAMENTO: ['ler', 'criar', 'editar'],
    ALERTA: ['ler', 'decidir'],
    TRIAGEM: ['ler', 'criar', 'decidir'],
    PERFIL_HABILITACAO: ['ler', 'editar'],
    PREFERENCIA_NOTIFICACAO: ['editar'],
  },
  CLIENTE_FINAL_READONLY: {
    CRITERIO_MONITORAMENTO: ['ler'],
    ALERTA: ['ler'],
    TRIAGEM: ['ler'],
    PERFIL_HABILITACAO: ['ler'],
    PREFERENCIA_NOTIFICACAO: ['editar'],
  },
  DPO_COMPLIANCE: {
    AUDIT_LOG: ['ler'],
    SOLICITACAO_TITULAR: ['decidir'],
  },
};

/**
 * Único ponto de verdade de "este papel pode tentar esta ação" (P-52).
 * Pura, sem I/O — não confirma posse do objeto (isso é AB1/P-51, camada separada).
 */
export function podeExecutar(papel: Papel, recurso: Recurso, acao: Acao): boolean {
  return MATRIZ[papel]?.[recurso]?.includes(acao) ?? false;
}
