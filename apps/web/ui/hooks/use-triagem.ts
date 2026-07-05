import { useState, useEffect } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { EditalId, PerfilId, TenantId, ClienteFinalId } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
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
 * 401 do BFF (sessão expirada) redireciona para login via AuthProvider.
 *
 * Os defaults de perfilId/tenantId/clienteFinalId são resolvidos pelo BFF via JWT;
 * os parâmetros são mantidos no input do use case para tipagem, mas o HTTP adapter
 * não os envia no header (o BFF deriva do token — A08 §5, P-08/P-51).
 */
export function useTriagem({
  editalId,
  perfilId = 'perfil-padrao',
  tenantId = 'tenant-demo',
  clienteFinalId = 'cliente-demo',
}: UseTriagemParams): TriagemState {
  const { getTriagem } = useUseCases();
  const { login } = useAuth();
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

        if (err instanceof SessaoExpiradaError) {
          // 401 do BFF → redireciona para Cognito; não atualiza estado (a página vai mudar).
          void login();
          return;
        }

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
  }, [editalId, perfilId, tenantId, clienteFinalId, getTriagem, login]);

  return state;
}
