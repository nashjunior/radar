/**
 * Predicado único de autorização de affordance (P-52 / docs/05 §4).
 *
 * O backend é a fonte de verdade — este módulo existe só para decidir
 * quais CTAs mostrar. A autorização real ocorre no backend.
 *
 * Matriz derivada de docs/05 §4, tabela "Matriz mínima de permissões".
 */
import type { Papel } from '@/domain/sessao';

export type Recurso =
  | 'CRITERIO_MONITORAMENTO'
  | 'ALERTA'
  | 'TRIAGEM'
  | 'PERFIL_HABILITACAO'
  | 'PREFERENCIA_NOTIFICACAO'
  | 'USUARIO_PAPEL';

export type Acao = 'ler' | 'criar' | 'editar';

type Matriz = Partial<Record<Papel, Partial<Record<Recurso, Acao[]>>>>;

const MATRIZ: Matriz = {
  ADMIN_CONSULTORIA: {
    CRITERIO_MONITORAMENTO:   ['ler', 'editar'],
    ALERTA:                   ['ler', 'editar'],
    TRIAGEM:                  ['ler', 'editar'],
    PERFIL_HABILITACAO:       ['ler', 'editar'],
    PREFERENCIA_NOTIFICACAO:  ['ler', 'editar'],
    USUARIO_PAPEL:            ['ler', 'editar'],
  },
  OPERADOR: {
    CRITERIO_MONITORAMENTO:   ['ler', 'editar'],
    ALERTA:                   ['ler', 'editar'],
    TRIAGEM:                  ['ler', 'editar'],
    PERFIL_HABILITACAO:       ['ler', 'editar'],
    PREFERENCIA_NOTIFICACAO:  ['ler', 'editar'],
  },
  CLIENTE_FINAL_READONLY: {
    CRITERIO_MONITORAMENTO:   ['ler'],
    ALERTA:                   ['ler'],
    TRIAGEM:                  ['ler'],
    PERFIL_HABILITACAO:       ['ler'],
    PREFERENCIA_NOTIFICACAO:  ['ler', 'editar'],
  },
  DPO_COMPLIANCE: {
    PREFERENCIA_NOTIFICACAO:  [],
  },
};

/** Retorna true se o papel pode executar a ação no recurso. Fail-closed: false se papel desconhecido. */
export function podeExecutar(papel: Papel, recurso: Recurso, acao: Acao): boolean {
  return MATRIZ[papel]?.[recurso]?.includes(acao) ?? false;
}
