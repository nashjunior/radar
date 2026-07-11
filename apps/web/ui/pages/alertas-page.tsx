/** @figma nodeId=11:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:91 (Dark) */
import { Badge, Button, CardEdital, Input } from '@/ui/components';
import type { EditalCardData, EditalStatus } from '@/ui/components';
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

function matchesTab(a: AlertaCardItem, tab: FilterTab): boolean {
  if (tab === 'todos') return true;
  if (tab === 'novos') return a.relevante === null;
  if (tab === 'revisados') return a.relevante === true;
  if (tab === 'arquivados') return a.relevante === false;
  return true;
}

interface AlertasPageProps {
  onTriagem: (editalId: string) => void;
}

export function AlertasPage({ onTriagem }: AlertasPageProps) {
  const [tab, setTab] = useState<FilterTab>('todos');
  const [search, setSearch] = useState('');
  const alertasState = useAlertas();

  const todosAlertas = alertasState.status === 'success' ? alertasState.data : [];
  const novosCount = todosAlertas.filter((a) => a.relevante === null).length;

  const filtered = todosAlertas
    .filter((a) => matchesTab(a, tab))
    .filter(
      (a) =>
        a.titulo.toLowerCase().includes(search.toLowerCase()) ||
        a.orgao.toLowerCase().includes(search.toLowerCase()),
    )
    .map(alertaParaCardData);

  return (
    <div style={{ maxWidth: 1120 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-3)', marginBottom: 'var(--radar-space-6)' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Alertas</h1>
        {alertasState.status === 'success' && novosCount > 0 && (
          <Badge type="sucesso" size="md">{novosCount} novos</Badge>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-3)', marginBottom: 'var(--radar-space-4)', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Buscar editais..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--radar-space-2)', marginBottom: 'var(--radar-space-5)' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            style={{
              border: tab === key ? 'none' : '1px solid var(--radar-color-border-default)',
              cursor: 'pointer',
              padding: '6px 16px',
              borderRadius: 'var(--radar-radius-full, 9999px)',
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? 'var(--radar-color-text-onPrimary)' : 'var(--radar-color-text-muted)',
              background: tab === key ? 'var(--radar-color-action-primary)' : 'transparent',
              fontSize: 'var(--radar-font-size-sm)',
              fontFamily: 'var(--radar-font-sans)',
              transition: 'background 0.15s, color 0.15s',
            } as React.CSSProperties}
          >
            {label}
          </button>
        ))}
      </div>

      {alertasState.status === 'error' && (
        <div style={{ marginBottom: 'var(--radar-space-4)', padding: '12px 16px', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', borderRadius: 'var(--radar-radius-sm)', fontSize: 'var(--radar-font-size-sm)', borderLeft: '4px solid var(--radar-color-feedback-erro-fg)' }}>
          Erro ao carregar alertas: {alertasState.message}
        </div>
      )}

      {alertasState.status === 'loading' ? (
        <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', padding: 'var(--radar-space-8) 0', textAlign: 'center' }}>
          Carregando alertas…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 'var(--radar-space-8) 0', textAlign: 'center', color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
          {search
            ? `Nenhum edital encontrado para "${search}".`
            : tab === 'todos'
              ? 'Nenhum alerta ainda. Configure seus critérios de busca para começar a receber editais.'
              : `Nenhum alerta na aba "${TABS.find((t) => t.key === tab)?.label}".`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
          {filtered.map((alerta) => (
            <div key={alerta.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-3)' }}>
              <div style={{ flex: 1 }}>
                <CardEdital data={alerta} onClick={() => onTriagem(alerta.id)} />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onTriagem(alerta.id)}
                style={{ flexShrink: 0 }}
              >
                Triar →
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
