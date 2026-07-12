import { useCallback, useEffect, useRef, useState } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { SalvarPreferenciasInput } from '@/application/ports';

type Estado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'sucesso' }
  | { status: 'erro'; mensagem: string };

export interface UseSalvarPreferenciasResult {
  estado: Estado;
  salvar: (input: SalvarPreferenciasInput) => Promise<void>;
}

export function useSalvarPreferenciasNotificacao(): UseSalvarPreferenciasResult {
  const { salvarPreferenciasNotificacao } = useUseCases();
  const { login } = useAuth();
  const [estado, setEstado] = useState<Estado>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const salvar = useCallback(
    async (input: SalvarPreferenciasInput) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setEstado({ status: 'loading' });
      try {
        await salvarPreferenciasNotificacao.executar(input, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setEstado({ status: 'sucesso' });
        }
      } catch (err: unknown) {
        if (ctrl.signal.aborted) return;

        if (err instanceof SessaoExpiradaError) {
          void login();
          return;
        }

        setEstado({
          status: 'erro',
          mensagem:
            err instanceof AcessoNegadoError
              ? 'Acesso negado.'
              : err instanceof Error
                ? err.message
                : 'Erro ao salvar preferências.',
        });
      }
    },
    [salvarPreferenciasNotificacao, login],
  );

  return { estado, salvar };
}
