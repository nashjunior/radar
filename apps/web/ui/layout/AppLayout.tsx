import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { BannerAssinatura } from '@/ui/components';
import { useAssinatura } from '@/ui/hooks/use-assinatura';

type Route = 'dashboard' | 'alertas' | 'triagem' | 'configurar' | 'perfil' | 'planos' | 'pagamento-processando';

interface AppLayoutProps {
  current: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}

export function AppLayout({ current, onNavigate, children }: AppLayoutProps) {
  const assinaturaState = useAssinatura();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const assinatura = assinaturaState.status === 'success' ? assinaturaState.data : null;
  const onVerPlanos = () => onNavigate('planos');

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--radar-color-bg-canvas)' }}>
      <Sidebar
        current={current}
        onNavigate={onNavigate}
        assinatura={assinatura}
        onVerPlanos={onVerPlanos}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {assinatura && !bannerDismissed && (
          <div style={{ padding: '12px 40px 0' }}>
            <BannerAssinatura
              assinatura={assinatura}
              onVerPlanos={onVerPlanos}
              onDismiss={() => setBannerDismissed(true)}
            />
          </div>
        )}
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
