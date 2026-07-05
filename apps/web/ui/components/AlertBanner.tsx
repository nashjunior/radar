/** @figma nodeId=40:46 fileKey=SAbjXOQO4gFAH4syq7VdQf */
type AlertType = 'info' | 'sucesso' | 'alerta' | 'erro';

interface AlertBannerProps {
  type?: AlertType;
  children: React.ReactNode;
  onDismiss?: () => void;
}

const TYPE_CONFIG: Record<AlertType, { bg: string; color: string; icon: string }> = {
  info:    { bg: 'var(--radar-color-feedback-info-bg)',    color: 'var(--radar-color-feedback-info-fg)',    icon: 'ℹ️' },
  sucesso: { bg: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', icon: '✅' },
  alerta:  { bg: 'var(--radar-color-feedback-alerta-bg)',  color: 'var(--radar-color-feedback-alerta-fg)',  icon: '⚠️' },
  erro:    { bg: 'var(--radar-color-feedback-erro-bg)',    color: 'var(--radar-color-feedback-erro-fg)',    icon: '❌' },
};

export function AlertBanner({ type = 'info', children, onDismiss }: AlertBannerProps) {
  const { bg, color, icon } = TYPE_CONFIG[type];
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--radar-space-3)',
        padding: '0 var(--radar-space-4)',
        height: 56,
        borderRadius: 'var(--radar-radius-md)',
        background: bg,
        color,
        fontFamily: 'var(--radar-font-sans)',
        fontSize: 'var(--radar-font-size-sm)',
        fontWeight: 500,
      }}
    >
      <span>{icon}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Fechar"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color,
            fontSize: '1rem',
            padding: 'var(--radar-space-1)',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
