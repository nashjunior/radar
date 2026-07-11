import { useCallback, useEffect, useRef, useState } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors.js';
import { useUseCases } from '@/ui/providers/use-cases-provider.js';
import { useAuth } from '@/ui/providers/auth-provider.js';
import type { PerfilHabilitacaoDTO } from '@/application/ports.js';

const VAZIO: PerfilHabilitacaoDTO = { habJuridica: '', habFiscal: '', habTecnica: '', habEconomica: '' };

type CarregarEstado =
  | { status: 'loading' }
  | { status: 'carregado' }
  | { status: 'erro'; mensagem: string };

type SalvarEstado =
  | { status: 'idle' }
  | { status: 'salvando' }
  | { status: 'salvo' }
  | { status: 'erro'; mensagem: string };

export interface UsePerfilHabilitacaoResult {
  campos: PerfilHabilitacaoDTO;
  carregarEstado: CarregarEstado;
  salvarEstado: SalvarEstado;
  setCampos: (campos: PerfilHabilitacaoDTO) => void;
  salvar: () => Promise<void>;
}

export function usePerfilHabilitacao(): UsePerfilHabilitacaoResult {
  const { consultarPerfilHabilitacao, salvarPerfilHabilitacao } = useUseCases();
  const { login } = useAuth();

  const [campos, setCampos] = useState<PerfilHabilitacaoDTO>(VAZIO);
  const [carregarEstado, setCarregarEstado] = useState<CarregarEstado>({ status: 'loading' });
  const [salvarEstado, setSalvarEstado] = useState<SalvarEstado>({ status: 'idle' });

  const salvarAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    setCarregarEstado({ status: 'loading' });

    consultarPerfilHabilitacao.executar({}, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setCampos(data ?? VAZIO);
        setCarregarEstado({ status: 'carregado' });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
        setCarregarEstado({
          status: 'erro',
          mensagem: err instanceof Error ? err.message : 'Erro ao carregar perfil.',
        });
      });

    return () => { ctrl.abort(); };
  }, [consultarPerfilHabilitacao, login]);

  useEffect(() => {
    return () => { salvarAbortRef.current?.abort(); };
  }, []);

  const salvar = useCallback(async () => {
    salvarAbortRef.current?.abort();
    const ctrl = new AbortController();
    salvarAbortRef.current = ctrl;

    setSalvarEstado({ status: 'salvando' });
    try {
      await salvarPerfilHabilitacao.executar(campos, ctrl.signal);
      if (!ctrl.signal.aborted) {
        setSalvarEstado({ status: 'salvo' });
      }
    } catch (err: unknown) {
      if (ctrl.signal.aborted) return;
      if (err instanceof SessaoExpiradaError) { void login(); return; }
      setSalvarEstado({
        status: 'erro',
        mensagem:
          err instanceof AcessoNegadoError
            ? 'Acesso negado.'
            : err instanceof Error
              ? err.message
              : 'Erro ao salvar perfil.',
      });
    }
  }, [salvarPerfilHabilitacao, campos, login]);

  return { campos, carregarEstado, salvarEstado, setCampos, salvar };
}
