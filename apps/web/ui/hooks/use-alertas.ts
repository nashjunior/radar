import { useEffect, useState } from 'react';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { useUseCases } from '@/ui/providers/use-cases-provider';

type AlertasState =
  | { status: 'loading' }
  | { status: 'success'; data: AlertaCardItem[] }
  | { status: 'error'; message: string };

export function useAlertas(): AlertasState {
  const { listarAlertas } = useUseCases();
  const [state, setState] = useState<AlertasState>({ status: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    listarAlertas
      .executar(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ac.abort();
  }, [listarAlertas]);

  return state;
}
