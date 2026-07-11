import { useState } from 'react';
import { Button } from '@/ui/components';
import { useAuth } from '@/ui/providers/auth-provider';

export function LoginPage() {
  const { login } = useAuth();
  const [carregando, setCarregando] = useState(false);

  async function handleLogin() {
    setCarregando(true);
    await login();
    // Se não houver redirect (ex.: dev mode sem Cognito real), volta ao estado inicial.
    setCarregando(false);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--radar-color-bg-canvas)',
      }}
    >
      <div
        style={{
          width: 360,
          background: 'var(--radar-color-bg-surface)',
          border: '1px solid var(--radar-color-border-default)',
          borderRadius: 'var(--radar-radius-lg)',
          padding: 'var(--radar-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--radar-space-6)',
        }}
      >
        <div>
          <h1
            style={{
              margin: '0 0 var(--radar-space-2)',
              fontSize: '1.25rem',
              fontWeight: 700,
              fontFamily: 'var(--radar-font-sans)',
              color: 'var(--radar-color-text-default)',
            }}
          >
            Radar de Licitações
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--radar-font-size-sm)',
              color: 'var(--radar-color-text-muted)',
              lineHeight: 1.5,
            }}
          >
            Monitore e analise editais com inteligência artificial.
          </p>
        </div>

        <Button
          variant="primary"
          size="lg"
          style={{ width: '100%' }}
          disabled={carregando}
          onClick={() => { void handleLogin(); }}
        >
          {carregando ? 'Redirecionando...' : 'Entrar'}
        </Button>
      </div>
    </div>
  );
}
