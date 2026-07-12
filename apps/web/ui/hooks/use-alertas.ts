import { useEffect, useRef, useState } from 'react';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { INTERVALO_POLL_ALERTAS_MS } from '@/ui/hooks/use-alertas-polling';

type AlertasState =
  | { status: 'loading' }
  | { status: 'success'; data: AlertaCardItem[] }
  | { status: 'error'; message: string };

interface UseAlertasOpts {
  /** Se > 0, refetch silencioso a cada N ms (default: 30 s). `0` = só na montagem. */
  pollIntervalMs?: number;
}

export function useAlertas(opts: UseAlertasOpts = {}): AlertasState {
  const pollIntervalMs = opts.pollIntervalMs ?? INTERVALO_POLL_ALERTAS_MS;
  const { listarAlertas } = useUseCases();
  const [state, setState] = useState<AlertasState>({ status: 'loading' });
  const primeiraCarga = useRef(true);

  useEffect(() => {
    const ac = new AbortController();

    const carregar = (silencioso: boolean) => {
      if (!silencioso) setState({ status: 'loading' });
      listarAlertas
        .executar(ac.signal)
        .then((data) => {
          if (!ac.signal.aborted) {
            primeiraCarga.current = false;
            setState({ status: 'success', data });
          }
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          // Em poll silencioso, preserva dados anteriores se já houver sucesso.
          setState((prev) => {
            if (silencioso && prev.status === 'success') return prev;
            return {
              status: 'error',
              message: err instanceof Error ? err.message : String(err),
            };
          });
        });
    };

    carregar(false);

    if (pollIntervalMs <= 0) {
      return () => ac.abort();
    }

    const handle = setInterval(() => carregar(true), pollIntervalMs);
    return () => {
      ac.abort();
      clearInterval(handle);
    };
  }, [listarAlertas, pollIntervalMs]);

  return state;
}
