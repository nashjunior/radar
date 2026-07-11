/** @figma nodeId=40:46 fileKey=SAbjXOQO4gFAH4syq7VdQf */
type AlertType = 'info' | 'sucesso' | 'alerta' | 'erro';

interface AlertBannerProps {
  type?: AlertType;
  /** Título em negrito antes do conteúdo (ex: "Info"). */
  title?: string;
  /** Link inline ao final da mensagem. */
  link?: { label: string; onClick: () => void };
  children: React.ReactNode;
  onDismiss?: () => void;
}

const TYPE_CONFIG: Record<AlertType, { bg: string; color: string; border: string; icon: string }> = {
  info:    { bg: 'var(--radar-color-feedback-info-bg)',    color: 'var(--radar-color-feedback-info-fg)',    border: 'var(--radar-color-feedback-info-fg)',    icon: 'ℹ️' },
  sucesso: { bg: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', border: 'var(--radar-color-feedback-sucesso-fg)', icon: '✅' },
  alerta:  { bg: 'var(--radar-color-feedback-alerta-bg)',  color: 'var(--radar-color-feedback-alerta-fg)',  border: 'var(--radar-color-feedback-alerta-fg)',  icon: '⚠️' },
  erro:    { bg: 'var(--radar-color-feedback-erro-bg)',    color: 'var(--radar-color-feedback-erro-fg)',    border: 'var(--radar-color-feedback-erro-fg)',    icon: '❌' },
};

export function AlertBanner({ type = 'info', title, link, children, onDismiss }: AlertBannerProps) {
  const { bg, color, border, icon } = TYPE_CONFIG[type];
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--radar-space-3)',
        padding: '12px var(--radar-space-4)',
        borderRadius: 'var(--radar-radius-md)',
        background: bg,
        color,
        fontFamily: 'var(--radar-font-sans)',
        fontSize: 'var(--radar-font-size-sm)',
        borderLeft: `4px solid ${border}`,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span style={{ flex: 1 }}>
        {title && <strong style={{ marginRight: 6 }}>{title}</strong>}
        {children}
        {link && (
          <button
            onClick={link.onClick}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color, fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 500, padding: '0 0 0 6px', textDecoration: 'underline' }}
          >
            {link.label}
          </button>
        )}
      </span>
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
