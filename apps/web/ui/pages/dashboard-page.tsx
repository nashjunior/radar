/** @figma nodeId=8:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:2 (Dark) */
import { AlertBanner, CardEdital, StatCard } from '@/ui/components';
import type { EditalCardData, EditalStatus } from '@/ui/components';
import { useAlertas } from '@/ui/hooks/use-alertas';
import type { AlertaCardItem } from '@/domain/alerta-card';

function alertaStatus(a: AlertaCardItem): EditalStatus {
  if (a.relevante !== null) return 'revisado';
  if (a.proveniencia?.fonte === 'PNCP') return 'pncp';
  if (a.dataAbertura) {
    const hoje = new Date().toDateString();
    if (new Date(a.dataAbertura).toDateString() === hoje) return 'hoje';
  }
  return 'novo';
}

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
    status: alertaStatus(a),
    ...(a.proveniencia !== undefined ? { proveniencia: a.proveniencia } : {}),
  };
}

interface DashboardPageProps {
  onTriagem: (editalId: string) => void;
  onVerAlertas?: () => void;
}

export function DashboardPage({ onTriagem, onVerAlertas }: DashboardPageProps) {
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

  type StatItem = { label: string; value: string | number; trend?: string; trendPositive?: boolean };
  const stats: StatItem[] = [
    { label: 'Editais monitorados', value: 142,   trend: '↑ 12 esta semana', trendPositive: true },
    {
      label: 'Novos alertas hoje',
      value: alertasState.status === 'success' ? novosAlertas : '…',
      ...(alertasState.status === 'success' ? { trend: `↑ ${novosAlertas} vs ontem`, trendPositive: true as const } : {}),
    },
    { label: 'Triagens pendentes',  value: 3,     trend: 'Aguardando revisão', trendPositive: false },
    { label: 'Aderência média',     value: alertasState.status === 'success' ? `${aderenciaMedia}%` : '…', trend: '↑ 2pp este mês', trendPositive: true },
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
          {onVerAlertas ? (
            <AlertBanner type="info" title="Info" link={{ label: 'Ver todos →', onClick: onVerAlertas }}>
              {novosAlertas} {novosAlertas === 1 ? 'novo edital encontrado que casa com seu perfil de monitoramento.' : 'novos editais encontrados que casam com seu perfil de monitoramento.'}
            </AlertBanner>
          ) : (
            <AlertBanner type="info" title="Info">
              {novosAlertas} {novosAlertas === 1 ? 'novo edital encontrado que casa com seu perfil de monitoramento.' : 'novos editais encontrados que casam com seu perfil de monitoramento.'}
            </AlertBanner>
          )}
        </div>
      )}

      {alertasState.status === 'success' && alertas.length === 0 && (
        <div style={{ marginBottom: 'var(--radar-space-6)' }}>
          <AlertBanner type="alerta" title="Cold start">
            Nenhum edital encontrado ainda. Configure os critérios de busca para começar a receber alertas.
          </AlertBanner>
        </div>
      )}

      {alertasState.status === 'error' && (
        <div style={{ marginBottom: 'var(--radar-space-6)' }}>
          <AlertBanner type="erro" title="Erro">
            Não foi possível carregar os alertas: {alertasState.message}
          </AlertBanner>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-4)' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Editais recentes</h2>
        {onVerAlertas && (
          <button
            onClick={onVerAlertas}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontSize: 'var(--radar-font-size-sm)', fontFamily: 'var(--radar-font-sans)' }}
          >
            Ver todos os alertas →
          </button>
        )}
      </div>

      {alertasState.status === 'loading' ? (
        <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', padding: 'var(--radar-space-6) 0' }}>
          Carregando…
        </div>
      ) : recentes.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
          {recentes.map((edital) => (
            <CardEdital key={edital.id} data={edital} onClick={() => onTriagem(edital.id)} />
          ))}
        </div>
      ) : alertasState.status === 'success' ? (
        <div style={{ padding: 'var(--radar-space-8) 0', textAlign: 'center', color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
          Nenhum edital recente. Configure seus critérios para começar a receber alertas.
        </div>
      ) : null}
    </div>
  );
}
