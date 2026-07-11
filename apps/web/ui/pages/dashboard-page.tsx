/** @figma nodeId=8:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:2 (Dark) */
import { AlertBanner, CardEdital, StatCard } from '@/ui/components';
import type { EditalCardData } from '@/ui/components';
import { useAlertas } from '@/ui/hooks/use-alertas';
import type { AlertaCardItem } from '@/domain/alerta-card';

function alertaParaCardData(a: AlertaCardItem): EditalCardData {
  const prazo = a.dataAbertura
    ? new Date(a.dataAbertura).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const valor = a.valorEstimado != null
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
}

export function DashboardPage({ onTriagem }: DashboardPageProps) {
  const alertasState = useAlertas();

  const alertas = alertasState.status === 'success' ? alertasState.data : [];
  const novosAlertas = alertas.filter((a) => a.relevante === null).length;
  const aderenciaMedia = alertas.length > 0
    ? Math.round(alertas.reduce((sum, a) => sum + a.aderencia, 0) / alertas.length)
    : 0;

  const recentes: EditalCardData[] = [...alertas]
    .sort((a, b) => b.aderencia - a.aderencia)
    .slice(0, 3)
    .map(alertaParaCardData);

  const stats = [
    { label: 'Editais monitorados', value: 142,             icon: '📁' },
    { label: 'Novos alertas',       value: alertasState.status === 'success' ? novosAlertas : '…', icon: '🔔' },
    { label: 'Triagens pendentes',  value: 3,               icon: '🔍' },
    { label: 'Aderência média',     value: alertasState.status === 'success' ? `${aderenciaMedia}%` : '…', icon: '📈' },
  ];

  return (
    <div style={{ maxWidth: 1120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-6)' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Bom dia, Oberware 👋</h1>
        <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
          {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-6)' }}>
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {alertasState.status === 'success' && novosAlertas > 0 && (
        <div style={{ marginBottom: 'var(--radar-space-6)' }}>
          <AlertBanner type="info">
            {novosAlertas} {novosAlertas === 1 ? 'novo edital correspondente ao seu perfil foi publicado' : 'novos editais correspondentes ao seu perfil foram publicados'} hoje.
          </AlertBanner>
        </div>
      )}

      {alertasState.status === 'error' && (
        <div style={{ marginBottom: 'var(--radar-space-6)', padding: '12px 16px', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', borderRadius: 'var(--radar-radius-sm)', fontSize: 'var(--radar-font-size-sm)' }}>
          Erro ao carregar alertas: {alertasState.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-4)' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Editais recentes</h2>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontSize: 'var(--radar-font-size-sm)' }}>
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
