import { useState, useEffect } from 'react';
import { EditalId } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { EditalDetalhe } from '@/domain/edital-detalhe';

export type EditalState =
  | { status: 'loading' }
  | { status: 'success'; data: EditalDetalhe }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export function useEdital(editalId: string): EditalState {
  const { getEdital } = useUseCases();
  const { login } = useAuth();
  const [state, setState] = useState<EditalState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    getEdital
      .executar({ editalId: EditalId(editalId) }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data === null) {
          setState({ status: 'not_found' });
        } else {
          setState({ status: 'success', data });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar edital' });
      });

    return () => { controller.abort(); };
  }, [editalId, getEdital, login]);

  return state;
}
