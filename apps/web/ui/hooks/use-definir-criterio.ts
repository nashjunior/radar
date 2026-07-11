import { useCallback, useEffect, useRef, useState } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { DefinirCriterioInput, CriterioResposta } from '@/application/ports';

type Estado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'sucesso'; criterio: CriterioResposta }
  | { status: 'erro'; mensagem: string };

export interface UseDefinirCriterioResult {
  estado: Estado;
  salvar: (input: DefinirCriterioInput) => Promise<void>;
}

export function useDefinirCriterio(): UseDefinirCriterioResult {
  const { definirCriterio } = useUseCases();
  const { login } = useAuth();
  const [estado, setEstado] = useState<Estado>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const salvar = useCallback(
    async (input: DefinirCriterioInput) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setEstado({ status: 'loading' });
      try {
        const criterio = await definirCriterio.executar(input, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setEstado({ status: 'sucesso', criterio });
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
                : 'Erro ao salvar critério.',
        });
      }
    },
    [definirCriterio, login],
  );

  return { estado, salvar };
}
