import { useCallback, useRef, useState } from 'react';
import { EditalId, PerfilId, TenantId } from '@radar/kernel';
import { SessaoExpiradaError, CotaExcedidaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';

type SolicitarEstado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'processando' }
  | { status: 'cota_excedida'; cota: number; usado: number; upgradeDisponivel: boolean }
  | { status: 'erro'; mensagem: string };

export interface UseSolicitarTriagemResult {
  estado: SolicitarEstado;
  solicitar: () => void;
  limpar: () => void;
}

interface Params {
  editalId: string;
  perfilId?: string;
  tenantId?: string;
}

/** Solicita análise de triagem por IA. Estado 'cota_excedida' quando o back retorna HTTP 402. */
export function useSolicitarTriagem({
  editalId,
  perfilId = 'perfil-padrao',
  tenantId = 'tenant-demo',
}: Params): UseSolicitarTriagemResult {
  const { solicitarTriagem } = useUseCases();
  const { login } = useAuth();
  const [estado, setEstado] = useState<SolicitarEstado>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const solicitar = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEstado({ status: 'loading' });

    solicitarTriagem
      .executar(
        { editalId: EditalId(editalId), perfilId: PerfilId(perfilId), tenantId: TenantId(tenantId) },
        ctrl.signal,
      )
      .then(() => {
        if (!ctrl.signal.aborted) setEstado({ status: 'processando' });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        if (err instanceof CotaExcedidaError) {
          setEstado({ status: 'cota_excedida', cota: err.cota, usado: err.usado, upgradeDisponivel: err.upgradeDisponivel });
          return;
        }
        setEstado({ status: 'erro', mensagem: err instanceof Error ? err.message : 'Erro ao solicitar triagem.' });
      });
  }, [editalId, perfilId, tenantId, solicitarTriagem, login]);

  const limpar = useCallback(() => setEstado({ status: 'idle' }), []);

  return { estado, solicitar, limpar };
}
