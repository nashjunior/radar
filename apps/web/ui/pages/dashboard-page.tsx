/** @figma nodeId=8:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:2 / 15:21 (Dark main) */
import { useCallback, useEffect, useState } from 'react';
import { AlertBanner, CardEdital, StatCard } from '@/ui/components';
import type { EditalCardData } from '@/ui/components';
import { useAlertas } from '@/ui/hooks/use-alertas';
import type { AlertaCardItem } from '@/domain/alerta-card';
import { authGateway } from '@/infra/container';

const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

function alertaParaCardData(a: AlertaCardItem): EditalCardData {
  const prazo = a.dataAbertura
    ? new Date(a.dataAbertura).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const valor =
    a.valorEstimado != null
      ? a.valorEstimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—';
  return {
    id: a.alertaId,
    modalidade: a.modalidade,
    titulo: a.titulo,
    orgao: a.orgao,
    valor,
    prazo,
    aderencia: a.aderencia,
    ...(a.proveniencia !== undefined ? { proveniencia: a.proveniencia } : {}),
  };
}

interface DashboardPageProps {
  onTriagem: (editalId: string) => void;
  onVerAlertas?: () => void;
}

export function DashboardPage({ onTriagem, onVerAlertas }: DashboardPageProps) {
  const alertasState = useAlertas();
  const [loteSize, setLoteSize] = useState<number | null>(null);

  const carregarStats = useCallback(async () => {
    try {
      const token = await authGateway.obterToken();
      const res = await fetch(`${apiBase}/api/demo/stats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const json = (await res.json()) as { loteSize?: number };
      if (typeof json.loteSize === 'number') setLoteSize(json.loteSize);
    } catch {
      /* demo stats opcional */
    }
  }, []);

  useEffect(() => {
    void carregarStats();
  }, [carregarStats]);

  const alertas = alertasState.status === 'success' ? alertasState.data : [];
  const novosAlertas = alertas.filter((a) => a.relevante === null).length;
  const pendentesTriagem = novosAlertas;
  const aderenciaMedia =
    alertas.length > 0
      ? Math.round(alertas.reduce((sum, a) => sum + a.aderencia, 0) / alertas.length)
      : 0;

  const recentes: EditalCardData[] = [...alertas]
    .sort((a, b) => b.aderencia - a.aderencia)
    .slice(0, 3)
    .map(alertaParaCardData);

  const monitorados = loteSize ?? alertas.length;

  const stats = [
    {
      label: 'Editais monitorados',
      value: alertasState.status === 'loading' ? '…' : monitorados,
      hint: loteSize != null ? 'Lote PNCP em memória' : undefined,
    },
    {
      label: 'Novos alertas hoje',
      value: alertasState.status === 'success' ? novosAlertas : '…',
      hint: novosAlertas > 0 ? 'Sem feedback ainda' : undefined,
    },
    {
      label: 'Triagens pendentes',
      value: alertasState.status === 'success' ? pendentesTriagem : '…',
      hint: 'Aguardando revisão',
    },
    {
      label: 'Aderência média',
      value: alertasState.status === 'success' ? `${aderenciaMedia}%` : '…',
      hint: alertas.length > 0 ? 'Sobre alertas gerados' : undefined,
    },
  ];

  return (
    <div style={{ maxWidth: 1120 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--radar-space-6)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Bom dia, Oberware</h1>
        <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
          {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-6)', flexWrap: 'wrap' }}>
        {stats.map((s) => (
          <div key={s.label} style={{ flex: '1 1 160px', minWidth: 140 }}>
            <StatCard label={s.label} value={s.value} />
            {s.hint && (
              <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
                {s.hint}
              </p>
            )}
          </div>
        ))}
      </div>

      {alertasState.status === 'success' && novosAlertas > 0 && (
        <div style={{ marginBottom: 'var(--radar-space-6)' }}>
          <AlertBanner type="info">
            {novosAlertas}{' '}
            {novosAlertas === 1
              ? 'novo edital encontrado que casa com seu perfil de monitoramento.'
              : 'novos editais encontrados que casam com seu perfil de monitoramento.'}{' '}
            <button
              type="button"
              onClick={() => onVerAlertas?.()}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Ver todos →
            </button>
          </AlertBanner>
        </div>
      )}

      {alertasState.status === 'success' && alertas.length === 0 && (
        <div
          style={{
            marginBottom: 'var(--radar-space-6)',
            padding: '12px 16px',
            borderRadius: 'var(--radar-radius-md)',
            border: '1px solid var(--radar-color-border-default)',
            background: 'var(--radar-color-bg-canvas)',
            fontSize: 'var(--radar-font-size-sm)',
            color: 'var(--radar-color-text-muted)',
            lineHeight: 1.45,
          }}
        >
          Nenhum alerta ainda. Fluxo: (1) Perfil de Habilitação → (2) Oportunidades “Atualizar PNCP” →
          (3) Configurar Radar (UF + palavras-chave) e salvar critério.
        </div>
      )}

      {alertasState.status === 'error' && (
        <div
          style={{
            marginBottom: 'var(--radar-space-6)',
            padding: '12px 16px',
            background: 'var(--radar-color-feedback-erro-bg)',
            color: 'var(--radar-color-feedback-erro-fg)',
            borderRadius: 'var(--radar-radius-sm)',
            fontSize: 'var(--radar-font-size-sm)',
          }}
        >
          Erro ao carregar alertas: {alertasState.message}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--radar-space-4)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Editais recentes</h2>
        <button
          type="button"
          onClick={() => onVerAlertas?.()}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--radar-color-action-primary)',
            fontSize: 'var(--radar-font-size-sm)',
          }}
        >
          Ver todos os alertas →
        </button>
      </div>

      {alertasState.status === 'loading' ? (
        <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', padding: 'var(--radar-space-6) 0' }}>
          Carregando…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
          {recentes.map((edital) => (
            <CardEdital key={edital.id} data={edital} onClick={() => onTriagem(edital.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
