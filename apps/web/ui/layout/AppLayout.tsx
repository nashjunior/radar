import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

type Route = 'dashboard' | 'alertas' | 'triagem' | 'configurar' | 'perfil';

interface AppLayoutProps {
  current: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}

export function AppLayout({ current, onNavigate, children }: AppLayoutProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--radar-color-bg-canvas)' }}>
      <Sidebar current={current} onNavigate={onNavigate} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
        {children}
      </main>
    </div>
  );
}
