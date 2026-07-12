/**
 * Fornece o contexto de sessão (papel + clienteFinalIds) para a UI.
 * Fail-closed: enquanto carregando, `sessao` é null — a UI não deve
 * renderizar ações de escrita até ter o papel confirmado.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessaoUsuario } from '@/domain/sessao';
import type { ObterSessaoUseCase } from '@/application/use-cases/obter-sessao';
import { AcessoNegadoError, SemOrganizacaoError } from '@/application/errors';

type SessaoEstado =
  | { status: 'carregando' }
  | { status: 'carregada'; sessao: SessaoUsuario }
  | { status: 'sem_organizacao' }
  | { status: 'sem_permissao' }
  | { status: 'erro'; mensagem: string };

interface SessaoContextValor {
  estado: SessaoEstado;
  /** Força re-fetch de GET /api/me — usar após provisionar a organização. */
  recarregar: () => void;
}

const SessaoContext = createContext<SessaoContextValor | null>(null);

export function useSessaoEstado(): SessaoContextValor {
  const ctx = useContext(SessaoContext);
  if (!ctx) throw new Error('useSessaoEstado deve ser usado dentro de SessaoProvider');
  return ctx;
}

interface SessaoProviderProps {
  obterSessaoUseCase: ObterSessaoUseCase;
  children: ReactNode;
}

export function SessaoProvider({ obterSessaoUseCase, children }: SessaoProviderProps) {
  const [estado, setEstado] = useState<SessaoEstado>({ status: 'carregando' });
  const [contador, setContador] = useState(0);

  const recarregar = useCallback(() => {
    setEstado({ status: 'carregando' });
    setContador((c) => c + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    obterSessaoUseCase
      .executar(ac.signal)
      .then((sessao) => {
        if (!ac.signal.aborted) setEstado({ status: 'carregada', sessao });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof SemOrganizacaoError) {
          setEstado({ status: 'sem_organizacao' });
        } else if (err instanceof AcessoNegadoError) {
          setEstado({ status: 'sem_permissao' });
        } else {
          setEstado({ status: 'erro', mensagem: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obterSessaoUseCase, contador]);

  return <SessaoContext.Provider value={{ estado, recarregar }}>{children}</SessaoContext.Provider>;
}
