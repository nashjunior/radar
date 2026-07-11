/** @figma nodeId=11:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:91 (Dark) */
import { Badge, CardEdital, Input } from '@/ui/components';
import type { EditalCardData } from '@/ui/components';
import { useState } from 'react';
import { useAlertas } from '@/ui/hooks/use-alertas';
import type { AlertaCardItem } from '@/domain/alerta-card';

type FilterTab = 'todos' | 'novos' | 'revisados' | 'arquivados';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'todos',      label: 'Todos' },
  { key: 'novos',      label: 'Novos' },
  { key: 'revisados',  label: 'Revisados' },
  { key: 'arquivados', label: 'Arquivados' },
];

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

interface AlertasPageProps {
  onTriagem: (editalId: string) => void;
}

export function AlertasPage({ onTriagem }: AlertasPageProps) {
  const [tab, setTab] = useState<FilterTab>('todos');
  const [search, setSearch] = useState('');
  const alertasState = useAlertas();

  const alertas: EditalCardData[] =
    alertasState.status === 'success' ? alertasState.data.map(alertaParaCardData) : [];

  const filtered = alertas.filter(
    (a) =>
      a.titulo.toLowerCase().includes(search.toLowerCase()) ||
      a.orgao.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ maxWidth: 1120 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-6)', fontSize: '1.25rem', fontWeight: 600 }}>Lista de Alertas</h1>

      {alertasState.status === 'error' && (
        <div style={{ marginBottom: 'var(--radar-space-4)', padding: '12px 16px', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', borderRadius: 'var(--radar-radius-sm)', fontSize: 'var(--radar-font-size-sm)' }}>
          Erro ao carregar alertas: {alertasState.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--radar-space-4)', marginBottom: 'var(--radar-space-4)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Buscar por título ou órgão..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge type="info" size="md">
          {alertasState.status === 'loading' ? '…' : `${filtered.length} alertas`}
        </Badge>
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

      {alertasState.status === 'loading' ? (
        <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', padding: 'var(--radar-space-6) 0' }}>
          Carregando alertas…
        </div>
      ) : (
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
      )}
    </div>
  );
}
