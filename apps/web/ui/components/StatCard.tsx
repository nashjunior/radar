/** @figma nodeId=39:90 fileKey=SAbjXOQO4gFAH4syq7VdQf */
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  /** Texto de tendência exibido abaixo do valor, ex: "↑ 12 esta semana". */
  trend?: string;
  trendPositive?: boolean;
}

export function StatCard({ label, value, icon, trend, trendPositive = true }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--radar-color-bg-surface)',
        border: '1px solid var(--radar-color-border-default)',
        borderRadius: 'var(--radar-radius-lg)',
        padding: 'var(--radar-space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--radar-space-2)',
        flex: 1,
      }}
    >
      <span style={{ fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
        {label}
      </span>
      {icon && <span style={{ fontSize: '1.25rem' }}>{icon}</span>}
      <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--radar-color-text-default)', lineHeight: 1 }}>
        {value}
      </span>
      {trend && (
        <span style={{
          fontSize: '0.75rem',
          color: trendPositive ? 'var(--radar-color-status-go)' : 'var(--radar-color-text-muted)',
        }}>
          {trend}
        </span>
      )}
    </div>
  );
}
