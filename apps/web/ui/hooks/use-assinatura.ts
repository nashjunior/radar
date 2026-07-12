import { useState, useEffect } from 'react';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { AssinaturaViewModel } from '@/domain/assinatura';

export type AssinaturaState =
  | { status: 'loading' }
  | { status: 'success'; data: AssinaturaViewModel }
  | { status: 'error'; message: string };

/** Carrega e mantém o estado da assinatura. Cancela a requisição ao desmontar. */
export function useAssinatura(): AssinaturaState {
  const { obterAssinatura } = useUseCases();
  const { login } = useAuth();
  const [state, setState] = useState<AssinaturaState>({ status: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });

    obterAssinatura
      .executar(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro desconhecido' });
      });

    return () => ac.abort();
  }, [obterAssinatura, login]);

  return state;
}
