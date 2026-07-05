/** @figma nodeId=8:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:2 (Dark) */
import { AlertBanner, CardEdital, StatCard } from '@/ui/components';
import type { EditalCardData } from '@/ui/components';

const MOCK_STATS = [
  { label: 'Editais monitorados', value: 142, icon: '📁' },
  { label: 'Novos alertas',       value: 8,   icon: '🔔' },
  { label: 'Triagens pendentes',  value: 3,   icon: '🔍' },
  { label: 'Aderência média',     value: '78%', icon: '📈' },
];

const MOCK_EDITAIS: EditalCardData[] = [
  {
    id: '001',
    modalidade: 'Pregão',
    titulo: 'Aquisição de equipamentos de informática para uso administrativo',
    orgao: 'Min. da Educação',
    valor: 'R$ 85.000,00',
    prazo: '10/07 às 14h',
    aderencia: 92,
  },
  {
    id: '002',
    modalidade: 'Concorrência',
    titulo: 'Contratação de serviços de desenvolvimento de software sob demanda',
    orgao: 'TRF - 1ª Região',
    valor: 'R$ 240.000,00',
    prazo: '15/07 às 10h',
    aderencia: 78,
  },
  {
    id: '003',
    modalidade: 'Dispensa',
    titulo: 'Fornecimento de licenças de software de gestão empresarial',
    orgao: 'ANATEL',
    valor: 'R$ 45.000,00',
    prazo: '08/07 às 17h',
    aderencia: 65,
  },
];

interface DashboardPageProps {
  onTriagem: (editalId: string) => void;
}

export function DashboardPage({ onTriagem }: DashboardPageProps) {
  return (
    <div style={{ maxWidth: 1120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-6)' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Bom dia, Oberware 👋</h1>
        <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
          {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-6)' }}>
        {MOCK_STATS.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div style={{ marginBottom: 'var(--radar-space-6)' }}>
        <AlertBanner type="info">
          8 novos editais correspondentes ao seu perfil foram publicados hoje.
        </AlertBanner>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-4)' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Editais recentes</h2>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontSize: 'var(--radar-font-size-sm)' }}>
          Ver todos os alertas →
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
        {MOCK_EDITAIS.map((edital) => (
          <CardEdital key={edital.id} data={edital} onClick={() => onTriagem(edital.id)} />
        ))}
      </div>
    </div>
  );
}
