import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/ui/providers/theme-provider';
import { AuthProvider, useAuth } from '@/ui/providers/auth-provider';
import { SessaoProvider, useSessaoEstado } from '@/ui/providers/sessao-provider';
import { UseCasesContext } from '@/ui/providers/use-cases-provider';
import { authGateway, useCases } from '@/infra/container';
import { AppLayout } from '@/ui/layout/AppLayout';
import { ModalUpgrade } from '@/ui/components';
import { DashboardPage } from '@/ui/pages/dashboard-page';
import { AlertasPage } from '@/ui/pages/alertas-page';
import { TriagemPage } from '@/ui/pages/triagem-page';
import { ConfigurarPage } from '@/ui/pages/configurar-page';
import { PerfilHabilitacaoPage } from '@/ui/pages/perfil-habilitacao-page';
import { PlanosPage } from '@/ui/pages/planos-page';
import { PagamentoProcessandoPage } from '@/ui/pages/pagamento-processando-page';
import { LoginPage } from '@/ui/pages/login-page';
import './globals.css';

type Route = 'dashboard' | 'alertas' | 'triagem' | 'configurar' | 'perfil' | 'planos' | 'pagamento-processando';

interface ModalUpgradeState {
  cota: number;
  usado: number;
  upgradeDisponivel: boolean;
}

function App() {
  const [route, setRoute] = useState<Route>('dashboard');
  const [triagemId, setTriagemId] = useState<string | undefined>();
  const [modalUpgrade, setModalUpgrade] = useState<ModalUpgradeState | null>(null);

  function navigateTo(r: Route) {
    setRoute(r);
  }

  function openTriagem(editalId: string) {
    setTriagemId(editalId);
    setRoute('triagem');
  }

  function abrirModalUpgrade(state: ModalUpgradeState) {
    setModalUpgrade(state);
  }

  return (
    <AppLayout current={route} onNavigate={navigateTo}>
      {route === 'dashboard'               && <DashboardPage onTriagem={openTriagem} onVerAlertas={() => navigateTo('alertas')} />}
      {route === 'alertas'                 && <AlertasPage onTriagem={openTriagem} />}
      {route === 'triagem'                 && <TriagemPage editalId={triagemId} onBack={() => setRoute('alertas')} onCotaExcedida={abrirModalUpgrade} />}
      {route === 'configurar'              && <ConfigurarPage />}
      {route === 'perfil'                  && <PerfilHabilitacaoPage />}
      {route === 'planos'                  && <PlanosPage onBack={() => navigateTo('dashboard')} />}
      {route === 'pagamento-processando'   && <PagamentoProcessandoPage onConfirmado={() => navigateTo('dashboard')} onVoltar={() => navigateTo('dashboard')} />}

      {modalUpgrade && (
        <ModalUpgrade
          cota={modalUpgrade.cota}
          usado={modalUpgrade.usado}
          upgradeDisponivel={modalUpgrade.upgradeDisponivel}
          onVerPlanos={() => { setModalUpgrade(null); navigateTo('planos'); }}
          onFechar={() => setModalUpgrade(null)}
        />
      )}
    </AppLayout>
  );
}

const loadingStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--radar-color-bg-canvas)',
  color: 'var(--radar-color-text-muted)',
  fontFamily: 'var(--radar-font-sans)',
  fontSize: 'var(--radar-font-size-sm)',
};

function SessaoGate({ children }: { children: React.ReactNode }) {
  const { estado } = useSessaoEstado();

  if (estado.status === 'carregando') {
    return <div style={loadingStyle}>Carregando...</div>;
  }

  if (estado.status === 'sem_permissao') {
    return (
      <div style={{ ...loadingStyle, color: 'var(--radar-color-feedback-erro-fg)' }}>
        Sem permissão para acessar este sistema.
      </div>
    );
  }

  if (estado.status === 'erro') {
    return (
      <div style={{ ...loadingStyle, color: 'var(--radar-color-feedback-erro-fg)' }}>
        Não foi possível carregar sua sessão: {estado.mensagem}
      </div>
    );
  }

  return <>{children}</>;
}

function AppGate() {
  const { estado } = useAuth();

  if (estado.status === 'carregando') {
    return <div style={loadingStyle}>Carregando...</div>;
  }

  if (estado.status === 'nao_autenticado') {
    return <LoginPage />;
  }

  return (
    <UseCasesContext.Provider value={useCases}>
      <SessaoProvider obterSessaoUseCase={useCases.obterSessao}>
        <SessaoGate>
          <App />
        </SessaoGate>
      </SessaoProvider>
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
