import { useState, useEffect } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { EditalId, PerfilId, TenantId, ClienteFinalId } from '@radar/kernel';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

interface UseTriagemParams {
  editalId: string;
  perfilId?: string;
  tenantId?: string;
  clienteFinalId?: string;
}

export type TriagemState =
  | { status: 'loading' }
  | { status: 'success'; data: TriagemViewModel }
  | { status: 'acesso_negado' }
  | { status: 'error'; message: string };

/**
 * Busca a triagem de um edital, cancelando a requisição ao desmontar (A12 §3.2).
 * Defaults de perfilId/tenantId/clienteFinalId são provisórios — remover ao integrar auth real.
 */
export function useTriagem({
  editalId,
  perfilId = 'perfil-padrao',
  tenantId = 'tenant-demo',
  clienteFinalId = 'cliente-demo',
}: UseTriagemParams): TriagemState {
  const { getTriagem } = useUseCases();
  const [state, setState] = useState<TriagemState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    getTriagem
      .executar(
        {
          editalId: EditalId(editalId),
          perfilId: PerfilId(perfilId),
          tenantId: TenantId(tenantId),
          clienteFinalId: ClienteFinalId(clienteFinalId),
        },
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', data });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof AcessoNegadoError) {
          setState({ status: 'acesso_negado' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, [editalId, perfilId, tenantId, clienteFinalId, getTriagem]);

  return state;
}
