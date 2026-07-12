/** @figma nodeId=RAD-251-pagamento-processando fileKey=SAbjXOQO4gFAH4syq7VdQf */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/components';
import { SessaoExpiradaError } from '@/application/errors';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import type { StatusAssinatura } from '@/domain/assinatura';

interface PagamentoProcessandoPageProps {
  onConfirmado: () => void;
  onVoltar: () => void;
}

const INTERVALO_MS = 5_000;

/**
 * Exibida após o retorno do checkout hospedado.
 * O acesso só é liberado via webhook invoice.paid — esta tela faz polling até o status mudar para 'ativa'.
 * PIX confirma em segundos; boleto pode levar 1–3 dias.
 */
export function PagamentoProcessandoPage({ onConfirmado, onVoltar }: PagamentoProcessandoPageProps) {
  const { obterAssinatura } = useUseCases();
  const { login } = useAuth();
  const [status, setStatus] = useState<StatusAssinatura | null>(null);
  const [tentativas, setTentativas] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function checar() {
      const ac = new AbortController();
      try {
        const assinatura = await obterAssinatura.executar(ac.signal);
        if (cancelado) return;
        setStatus(assinatura.status);
        setTentativas((n) => n + 1);
        if (assinatura.status === 'ativa') {
          onConfirmado();
          return;
        }
      } catch (err: unknown) {
        if (cancelado) return;
        if (err instanceof SessaoExpiradaError) { void login(); return; }
      }
      if (!cancelado) {
        timerRef.current = setTimeout(checar, INTERVALO_MS);
      }
    }

    void checar();

    return () => {
      cancelado = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [obterAssinatura, login, onConfirmado]);

  return (
    <div style={{ maxWidth: 520, margin: '80px auto 0', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 'var(--radar-space-6)' }}>⏳</div>
      <h1 style={{ margin: '0 0 var(--radar-space-4)', fontSize: 'var(--radar-fontSize-2xl)', fontFamily: 'var(--radar-fontFamily-sans)', color: 'var(--radar-color-text-default)' }}>
        Pagamento em processamento
      </h1>
      <p style={{ margin: '0 0 var(--radar-space-6)', color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-base)', lineHeight: 1.6 }}>
        Aguardando confirmação do gateway. PIX é confirmado em segundos; boleto pode levar até 3 dias úteis.
        Esta página atualiza automaticamente — não feche o navegador.
      </p>
      {tentativas > 0 && status && status !== 'ativa' && (
        <p style={{ color: 'var(--radar-color-text-muted)', fontFamily: 'var(--radar-fontFamily-sans)', fontSize: 'var(--radar-fontSize-sm)', marginBottom: 'var(--radar-space-6)' }}>
          Status atual: <strong>{traduzirStatus(status)}</strong>
        </p>
      )}
      <Button variant="ghost" onClick={onVoltar}>
        Voltar ao dashboard
      </Button>
    </div>
  );
}

function traduzirStatus(s: StatusAssinatura): string {
  const mapa: Record<StatusAssinatura, string> = {
    trial: 'trial',
    ativa: 'ativa',
    inadimplente: 'pagamento pendente',
    suspensa: 'suspensa',
    cancelada: 'cancelada',
  };
  return mapa[s] ?? s;
}
