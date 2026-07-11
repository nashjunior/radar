/**
 * Expõe a sessão atual e o predicado de autorização de affordance.
 * Retorna null para `sessao` enquanto carregando ou em erro — uso: fail-closed.
 */
import { useSessaoEstado } from '@/ui/providers/sessao-provider';
import { podeExecutar } from '@/application/autorizacao';
import type { Recurso, Acao } from '@/application/autorizacao';
import type { SessaoUsuario } from '@/domain/sessao';

interface UseSessaoResult {
  sessao: SessaoUsuario | null;
  /** Retorna false se sessão ainda não carregada (fail-closed). */
  pode(recurso: Recurso, acao: Acao): boolean;
}

export function useSessao(): UseSessaoResult {
  const { estado } = useSessaoEstado();
  const sessao = estado.status === 'carregada' ? estado.sessao : null;

  return {
    sessao,
    pode: (recurso, acao) => (sessao ? podeExecutar(sessao.papel, recurso, acao) : false),
  };
}
