import { useCallback, useRef, useState } from 'react';
import { SessaoExpiradaError, CnpjInvalidoError, OrganizacaoJaExisteError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { OrganizacaoDTO } from '@/application/ports';

type EstadoProvisionar =
  | { status: 'idle' }
  | { status: 'enviando' }
  | { status: 'concluido'; org: OrganizacaoDTO }
  | { status: 'erro'; campo: 'cnpj' | null; mensagem: string };

export interface UseProvisionarOrganizacaoResult {
  estado: EstadoProvisionar;
  provisionar: (input: { cnpj: string; razaoSocial: string }) => void;
}

export function useProvisionarOrganizacao(): UseProvisionarOrganizacaoResult {
  const { provisionarOrganizacao } = useUseCases();
  const { login } = useAuth();
  const [estado, setEstado] = useState<EstadoProvisionar>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const provisionar = useCallback(
    (input: { cnpj: string; razaoSocial: string }) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setEstado({ status: 'enviando' });

      provisionarOrganizacao
        .executar(input, ctrl.signal)
        .then((org) => {
          if (ctrl.signal.aborted) return;
          setEstado({ status: 'concluido', org });
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          if (err instanceof SessaoExpiradaError) { void login(); return; }
          if (err instanceof CnpjInvalidoError) {
            setEstado({ status: 'erro', campo: 'cnpj', mensagem: err.message });
          } else if (err instanceof OrganizacaoJaExisteError) {
            setEstado({ status: 'erro', campo: 'cnpj', mensagem: err.message });
          } else {
            setEstado({ status: 'erro', campo: null, mensagem: err instanceof Error ? err.message : 'Erro ao criar organização.' });
          }
        });
    },
    [provisionarOrganizacao, login],
  );

  return { estado, provisionar };
}
