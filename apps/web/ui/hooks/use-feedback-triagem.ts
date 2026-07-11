import { useCallback, useRef, useState } from 'react';
import { EditalId, PerfilId, TenantId } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';

type AcaoEstado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'sucesso' }
  | { status: 'erro'; mensagem: string };

export interface UseFeedbackTriagemResult {
  decisaoEstado: AcaoEstado;
  contestarEstado: AcaoEstado;
  registrarDecisao: (go: boolean) => Promise<void>;
  contestar: (motivo?: string) => Promise<void>;
}

/** Parâmetros resolvidos pelo BFF via JWT — valores default válidos para dev/demo. */
interface Params {
  editalId: string;
  perfilId?: string;
  tenantId?: string;
}

export function useFeedbackTriagem({
  editalId,
  perfilId = 'perfil-padrao',
  tenantId = 'tenant-demo',
}: Params): UseFeedbackTriagemResult {
  const { feedbackTriagem } = useUseCases();
  const { login } = useAuth();
  const [decisaoEstado, setDecisaoEstado] = useState<AcaoEstado>({ status: 'idle' });
  const [contestarEstado, setContestarEstado] = useState<AcaoEstado>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const runAction = useCallback(
    async (
      action: (signal: AbortSignal) => Promise<void>,
      setEstado: (s: AcaoEstado) => void,
    ) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setEstado({ status: 'loading' });
      try {
        await action(ctrl.signal);
        if (!ctrl.signal.aborted) setEstado({ status: 'sucesso' });
      } catch (err: unknown) {
        if (ctrl.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        setEstado({
          status: 'erro',
          mensagem: err instanceof Error ? err.message : 'Erro ao registrar.',
        });
      }
    },
    [login],
  );

  const base = {
    tenantId: TenantId(tenantId),
    editalId: EditalId(editalId),
    perfilId: PerfilId(perfilId),
  };

  const registrarDecisao = useCallback(
    (go: boolean) => runAction(
      (signal) => feedbackTriagem.registrarDecisao({ ...base, go }, signal),
      setDecisaoEstado,
    ),
    [feedbackTriagem, runAction, base.editalId, base.tenantId, base.perfilId],
  );

  const contestar = useCallback(
    (motivo?: string) => runAction(
      (signal) => feedbackTriagem.contestar({ ...base, ...(motivo ? { motivo } : {}) }, signal),
      setContestarEstado,
    ),
    [feedbackTriagem, runAction, base.editalId, base.tenantId, base.perfilId],
  );

  return { decisaoEstado, contestarEstado, registrarDecisao, contestar };
}
