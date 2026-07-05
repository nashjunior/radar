/** @figma nodeId=8:49 fileKey=SAbjXOQO4gFAH4syq7VdQf */
import { Badge } from './Badge';

export interface EditalCardData {
  id: string;
  modalidade: string;
  titulo: string;
  orgao: string;
  valor: string;
  prazo: string;
  aderencia: number;
}

type CardState = 'default' | 'hover' | 'selected';

interface CardEditalProps {
  data: EditalCardData;
  state?: CardState;
  onClick?: () => void;
}

function aderenciaColor(pct: number): string {
  if (pct >= 80) return 'var(--radar-color-status-go)';
  if (pct >= 50) return 'var(--radar-color-status-pendente)';
  return 'var(--radar-color-text-muted)';
}

export function CardEdital({ data, state = 'default', onClick }: CardEditalProps) {
  const selected = state === 'selected';
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 104,
        borderRadius: 'var(--radar-radius-md)',
        background: 'var(--radar-color-bg-surface)',
        border: `1px solid ${selected ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)'}`,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: state === 'hover' || state === 'selected' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-2)' }}>
          <Badge type="info" size="sm">{data.modalidade}</Badge>
        </div>
        <p style={{ margin: 0, fontWeight: 500, fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-default)', lineHeight: 1.4 }}>
          {data.titulo}
        </p>
        <div style={{ display: 'flex', gap: 'var(--radar-space-6)', fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
          <span>{data.orgao}</span>
          <span>{data.valor}</span>
          <span>⏱ {data.prazo}</span>
        </div>
      </div>
      <div style={{
        width: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderLeft: '1px solid var(--radar-color-border-default)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: aderenciaColor(data.aderencia) }}>
          {data.aderencia}%
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--radar-color-text-muted)', marginTop: 4 }}>aderência</span>
      </div>
    </div>
  );
}
