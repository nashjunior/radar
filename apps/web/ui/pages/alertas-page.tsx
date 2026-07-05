/** @figma nodeId=11:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:91 (Dark) */
import { Badge, CardEdital, Input } from '@/ui/components';
import type { EditalCardData } from '@/ui/components';
import { useState } from 'react';

type FilterTab = 'todos' | 'novos' | 'revisados' | 'arquivados';

const MOCK_ALERTAS: EditalCardData[] = [
  { id: '001', modalidade: 'Pregão',       titulo: 'Aquisição de equipamentos de informática para uso administrativo', orgao: 'Min. da Educação', valor: 'R$ 85.000,00',  prazo: '10/07 às 14h', aderencia: 92 },
  { id: '002', modalidade: 'Concorrência', titulo: 'Contratação de serviços de desenvolvimento de software sob demanda',  orgao: 'TRF - 1ª Região',  valor: 'R$ 240.000,00', prazo: '15/07 às 10h', aderencia: 78 },
  { id: '003', modalidade: 'Dispensa',     titulo: 'Fornecimento de licenças de software de gestão empresarial',         orgao: 'ANATEL',           valor: 'R$ 45.000,00',  prazo: '08/07 às 17h', aderencia: 65 },
  { id: '004', modalidade: 'Pregão',       titulo: 'Contratação de suporte técnico especializado em infraestrutura TI',  orgao: 'SERPRO',           valor: 'R$ 180.000,00', prazo: '20/07 às 09h', aderencia: 85 },
  { id: '005', modalidade: 'Concorrência', titulo: 'Desenvolvimento e manutenção de sistemas de informação governamental', orgao: 'CGU',              valor: 'R$ 500.000,00', prazo: '25/07 às 14h', aderencia: 71 },
];

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'todos',      label: 'Todos' },
  { key: 'novos',      label: 'Novos' },
  { key: 'revisados',  label: 'Revisados' },
  { key: 'arquivados', label: 'Arquivados' },
];

interface AlertasPageProps {
  onTriagem: (editalId: string) => void;
}

export function AlertasPage({ onTriagem }: AlertasPageProps) {
  const [tab, setTab] = useState<FilterTab>('todos');
  const [search, setSearch] = useState('');

  const filtered = MOCK_ALERTAS.filter((a) =>
    a.titulo.toLowerCase().includes(search.toLowerCase()) ||
    a.orgao.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1120 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-6)', fontSize: '1.25rem', fontWeight: 600 }}>Lista de Alertas</h1>

      <div style={{ display: 'flex', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-4)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Buscar por título ou órgão..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge type="info" size="md">{filtered.length} alertas</Badge>
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-2)', marginBottom: 'var(--radar-space-6)', borderBottom: '1px solid var(--radar-color-border-default)', paddingBottom: 'var(--radar-space-3)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '4px 12px',
              borderRadius: 'var(--radar-radius-sm)',
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? 'var(--radar-color-action-primary)' : 'var(--radar-color-text-muted)',
              background: tab === key ? 'var(--radar-color-bg-subtle)' : 'transparent',
              fontSize: 'var(--radar-font-size-sm)',
              fontFamily: 'var(--radar-font-sans)',
            } as React.CSSProperties}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
        {filtered.map((alerta) => (
          <div key={alerta.id} style={{ position: 'relative' }}>
            <CardEdital data={alerta} onClick={() => onTriagem(alerta.id)} />
            <button
              onClick={() => onTriagem(alerta.id)}
              style={{
                position: 'absolute',
                right: 116,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'var(--radar-color-action-primary)',
                color: 'var(--radar-color-text-onPrimary)',
                border: 'none',
                borderRadius: 'var(--radar-radius-sm)',
                padding: '4px 12px',
                cursor: 'pointer',
                fontSize: 'var(--radar-font-size-sm)',
                fontFamily: 'var(--radar-font-sans)',
              }}
            >
              Triar →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
