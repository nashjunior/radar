/** @figma nodeId=42:231 fileKey=SAbjXOQO4gFAH4syq7VdQf */
interface NavItemProps {
  label: string;
  icon?: string;
  active?: boolean;
  /** Contagem de novidades (ex.: alertas não vistos). */
  badge?: number;
  onClick?: () => void;
}

export function NavItem({ label, icon, active = false, badge, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--radar-space-2)',
        padding: '0 var(--radar-space-3)',
        height: 38,
        width: '100%',
        borderRadius: 'var(--radar-radius-md)',
        background: active ? 'var(--radar-color-bg-subtle)' : 'transparent',
        color: active ? 'var(--radar-color-action-primary)' : 'var(--radar-color-text-muted)',
        fontWeight: active ? 600 : 400,
        fontSize: 'var(--radar-font-size-sm)',
        fontFamily: 'var(--radar-font-sans)',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon && <span style={{ fontSize: '1rem' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span
          style={{
            minWidth: 20,
            height: 20,
            padding: '0 6px',
            borderRadius: 999,
            background: 'var(--radar-color-action-primary)',
            color: 'var(--radar-color-text-on-action, #fff)',
            fontSize: '0.7rem',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}
