import { NavItem } from '@/ui/components';
import { useTheme } from '@/ui/providers/theme-provider';

type Route = 'dashboard' | 'alertas' | 'oportunidades' | 'triagem' | 'configurar' | 'perfil';

interface SidebarProps {
  current: Route;
  onNavigate: (route: Route) => void;
}

const NAV_ITEMS: { route: Route; icon: string; label: string }[] = [
  { route: 'oportunidades', icon: '📡', label: 'Oportunidades' },
  { route: 'dashboard',  icon: '📊', label: 'Dashboard' },
  { route: 'alertas',    icon: '🔔', label: 'Alertas' },
  { route: 'perfil',     icon: '📋', label: 'Perfil de Habilitação' },
  { route: 'configurar', icon: '⚙️', label: 'Configurar Radar' },
];

export function Sidebar({ current, onNavigate }: SidebarProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <aside
      style={{
        width: 240,
        height: '100dvh',
        background: 'var(--radar-color-bg-surface)',
        borderRight: '1px solid var(--radar-color-border-default)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--radar-space-6) var(--radar-space-3)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
      }}
    >
      <div style={{ padding: '0 var(--radar-space-3)', marginBottom: 'var(--radar-space-6)' }}>
        <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--radar-color-text-default)' }}>
          ⚡ Radar de Licitações
        </span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-1)', flex: 1 }}>
        {NAV_ITEMS.map(({ route, icon, label }) => (
          <NavItem
            key={route}
            icon={icon}
            label={label}
            active={current === route || (current === 'triagem' && route === 'alertas')}
            onClick={() => onNavigate(route)}
          />
        ))}
      </nav>

      <button
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        title={`Mudar para tema ${resolvedTheme === 'dark' ? 'claro' : 'escuro'}`}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.25rem',
          padding: 'var(--radar-space-2)',
          borderRadius: 'var(--radar-radius-md)',
          color: 'var(--radar-color-text-muted)',
          alignSelf: 'flex-start',
        }}
      >
        {resolvedTheme === 'dark' ? '☀️' : '🌙'}
      </button>
    </aside>
  );
}
