/** @figma nodeId=42:231 fileKey=SAbjXOQO4gFAH4syq7VdQf */
interface NavItemProps {
  label: string;
  icon?: string;
  active?: boolean;
  onClick?: () => void;
}

export function NavItem({ label, icon, active = false, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
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
      {label}
    </button>
  );
}
