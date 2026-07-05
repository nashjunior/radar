import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/ui/providers/theme-provider';
import { UseCasesContext } from '@/ui/providers/use-cases-provider';
import { useCases } from '@/infra/container';
import { AppLayout } from '@/ui/layout/AppLayout';
import { DashboardPage } from '@/ui/pages/dashboard-page';
import { AlertasPage } from '@/ui/pages/alertas-page';
import { TriagemPage } from '@/ui/pages/triagem-page';
import { ConfigurarPage } from '@/ui/pages/configurar-page';
import './globals.css';

type Route = 'dashboard' | 'alertas' | 'triagem' | 'configurar';

function App() {
  const [route, setRoute] = useState<Route>('dashboard');
  const [triagemId, setTriagemId] = useState<string | undefined>();

  function navigateTo(r: Route) {
    setRoute(r);
  }

  function openTriagem(editalId: string) {
    setTriagemId(editalId);
    setRoute('triagem');
  }

  return (
    <AppLayout current={route} onNavigate={navigateTo}>
      {route === 'dashboard'  && <DashboardPage onTriagem={openTriagem} />}
      {route === 'alertas'    && <AlertasPage onTriagem={openTriagem} />}
      {route === 'triagem'    && <TriagemPage editalId={triagemId} onBack={() => setRoute('alertas')} />}
      {route === 'configurar' && <ConfigurarPage />}
    </AppLayout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <UseCasesContext.Provider value={useCases}>
        <App />
      </UseCasesContext.Provider>
    </ThemeProvider>
  </StrictMode>,
);
