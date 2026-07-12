import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { useUseCases } from '@/ui/providers/use-cases-provider';

/**
 * Poll da UI para avisar dados novos (alertas em memória / rematch).
 * Independente da cadência PNCP no backend (P-29 = 5 min).
 */
export const INTERVALO_POLL_ALERTAS_MS = 30_000;

export interface AlertasPollingState {
  /** Quantidade de alertas ainda não “vistos” pelo usuário. */
  novosNaoVistos: number;
  /** Total atual no store (último poll bem-sucedido). */
  total: number;
  marcarVistos: () => void;
}

/**
 * Polling global de alertas: compara IDs com o snapshot da última visita.
 * Intervalo padrão: 30 s.
 */
export function useAlertasPolling(
  intervaloMs: number = INTERVALO_POLL_ALERTAS_MS,
): AlertasPollingState {
  const { listarAlertas } = useUseCases();
  const [novosNaoVistos, setNovosNaoVistos] = useState(0);
  const [total, setTotal] = useState(0);
  const vistosRef = useRef<Set<string> | null>(null);
  const emVooRef = useRef(false);

  const consultar = useCallback(async (signal: AbortSignal) => {
    if (emVooRef.current) return;
    emVooRef.current = true;
    try {
      const data: AlertaCardItem[] = await listarAlertas.executar(signal);
      if (signal.aborted) return;
      setTotal(data.length);

      const ids = new Set(data.map((a) => a.alertaId));
      if (vistosRef.current === null) {
        // Primeira carga: estabelece baseline sem aviso (não assusta no login).
        vistosRef.current = ids;
        setNovosNaoVistos(0);
        return;
      }

      let novos = 0;
      for (const id of ids) {
        if (!vistosRef.current.has(id)) novos++;
      }
      setNovosNaoVistos(novos);
    } catch {
      /* rede/abort — silencioso no poll de fundo */
    } finally {
      emVooRef.current = false;
    }
  }, [listarAlertas]);

  useEffect(() => {
    const ac = new AbortController();
    void consultar(ac.signal);
    const handle = setInterval(() => {
      void consultar(ac.signal);
    }, intervaloMs);
    return () => {
      ac.abort();
      clearInterval(handle);
    };
  }, [consultar, intervaloMs]);

  const marcarVistos = useCallback(() => {
    void listarAlertas.executar(new AbortController().signal).then((data) => {
      vistosRef.current = new Set(data.map((a) => a.alertaId));
      setNovosNaoVistos(0);
      setTotal(data.length);
    }).catch(() => {
      /* ignore */
    });
  }, [listarAlertas]);

  return { novosNaoVistos, total, marcarVistos };
}
