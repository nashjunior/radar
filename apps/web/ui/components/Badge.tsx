/** @figma nodeId=40:56 fileKey=SAbjXOQO4gFAH4syq7VdQf */
type BadgeType = 'info' | 'sucesso' | 'alerta' | 'erro' | 'neutro';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  type?: BadgeType;
  size?: BadgeSize;
  children: React.ReactNode;
}

const TYPE_STYLES: Record<BadgeType, React.CSSProperties> = {
  info:    { background: 'var(--radar-color-feedback-info-bg)',    color: 'var(--radar-color-feedback-info-fg)' },
  sucesso: { background: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)' },
  alerta:  { background: 'var(--radar-color-feedback-alerta-bg)',  color: 'var(--radar-color-feedback-alerta-fg)' },
  erro:    { background: 'var(--radar-color-feedback-erro-bg)',    color: 'var(--radar-color-feedback-erro-fg)' },
  neutro:  { background: 'var(--radar-color-bg-overlay)', color: 'var(--radar-color-text-muted)' },
};

const SIZE_STYLES: Record<BadgeSize, React.CSSProperties> = {
  sm: { fontSize: '0.7rem', padding: '2px 8px', height: 20 },
  md: { fontSize: 'var(--radar-font-size-sm)', padding: '4px 12px', height: 24 },
};

export function Badge({ type = 'info', size = 'sm', children }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 'var(--radar-radius-sm)',
        fontWeight: 500,
        fontFamily: 'var(--radar-font-sans)',
        ...SIZE_STYLES[size],
        ...TYPE_STYLES[type],
      }}
    >
      {children}
    </span>
  );
}
