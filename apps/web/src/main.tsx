import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/ui/providers/theme-provider';
import { AuthProvider, useAuth } from '@/ui/providers/auth-provider';
import { UseCasesContext } from '@/ui/providers/use-cases-provider';
import { authGateway, useCases } from '@/infra/container';
import { AppLayout } from '@/ui/layout/AppLayout';
import { DashboardPage } from '@/ui/pages/dashboard-page';
import { AlertasPage } from '@/ui/pages/alertas-page';
import { TriagemPage } from '@/ui/pages/triagem-page';
import { ConfigurarPage } from '@/ui/pages/configurar-page';
import { PerfilHabilitacaoPage } from '@/ui/pages/perfil-habilitacao-page';
import { OportunidadesPage } from '@/ui/pages/oportunidades-page';
import { LoginPage } from '@/ui/pages/login-page';
import './globals.css';

type Route = 'dashboard' | 'alertas' | 'oportunidades' | 'triagem' | 'configurar' | 'perfil';

function App() {
  const [route, setRoute] = useState<Route>('oportunidades');
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
      {route === 'dashboard'     && <DashboardPage onTriagem={openTriagem} />}
      {route === 'alertas'       && <AlertasPage onTriagem={openTriagem} />}
      {route === 'oportunidades' && <OportunidadesPage />}
      {route === 'triagem'       && <TriagemPage editalId={triagemId} onBack={() => setRoute('alertas')} />}
      {route === 'configurar'    && <ConfigurarPage />}
      {route === 'perfil'        && <PerfilHabilitacaoPage />}
    </AppLayout>
  );
}

function AppGate() {
  const { estado } = useAuth();

  if (estado.status === 'carregando') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--radar-color-bg-canvas)',
          color: 'var(--radar-color-text-muted)',
          fontFamily: 'var(--radar-font-sans)',
          fontSize: 'var(--radar-font-size-sm)',
        }}
      >
        Carregando...
      </div>
    );
  }

  if (estado.status === 'nao_autenticado') {
    return <LoginPage />;
  }

  return (
    <UseCasesContext.Provider value={useCases}>
      <App />
    </UseCasesContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider authGateway={authGateway}>
        <AppGate />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
