import { useCallback, useRef, useState } from 'react';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';

type CheckoutEstado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'erro'; mensagem: string };

export interface UseIniciarCheckoutResult {
  estado: CheckoutEstado;
  iniciar: (planoCodigo: string) => void;
}

/**
 * Chama POST /api/checkout/iniciar com o planoCodigo escolhido e redireciona para a URL do gateway.
 * O retorno do checkout NÃO significa acesso liberado — apenas o webhook invoice.paid libera.
 */
export function useIniciarCheckout(): UseIniciarCheckoutResult {
  const { iniciarCheckout } = useUseCases();
  const { login } = useAuth();
  const [estado, setEstado] = useState<CheckoutEstado>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const iniciar = useCallback((planoCodigo: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEstado({ status: 'loading' });

    iniciarCheckout
      .executar({ planoCodigo }, ctrl.signal)
      .then(({ urlCheckout }) => {
        if (ctrl.signal.aborted) return;
        window.location.href = urlCheckout;
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        setEstado({ status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao iniciar checkout.' });
      });
  }, [iniciarCheckout, login]);

  return { estado, iniciar };
}
