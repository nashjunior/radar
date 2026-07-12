import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { AlertBanner } from '@/ui/components';

type Route = 'dashboard' | 'alertas' | 'oportunidades' | 'triagem' | 'configurar' | 'perfil';

interface AppLayoutProps {
  current: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
  /** Novos alertas ainda não abertos pelo usuário. */
  badgeAlertas?: number;
  onVerAlertasNovos?: () => void;
  onDispensarNovos?: () => void;
}

export function AppLayout({
  current,
  onNavigate,
  children,
  badgeAlertas = 0,
  onVerAlertasNovos,
  onDispensarNovos,
}: AppLayoutProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--radar-color-bg-canvas)' }}>
      <Sidebar current={current} onNavigate={onNavigate} badgeAlertas={badgeAlertas} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', position: 'relative' }}>
        {badgeAlertas > 0 && current !== 'alertas' && (
          <div style={{ marginBottom: 'var(--radar-space-6)', position: 'sticky', top: 0, zIndex: 10 }}>
            <AlertBanner
              type="info"
              {...(onDispensarNovos ? { onDismiss: onDispensarNovos } : {})}
            >
              {badgeAlertas === 1
                ? '1 novo alerta casou com seu radar.'
                : `${badgeAlertas} novos alertas casaram com seu radar.`}{' '}
              <button
                type="button"
                onClick={onVerAlertasNovos}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Ver agora →
              </button>
            </AlertBanner>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
