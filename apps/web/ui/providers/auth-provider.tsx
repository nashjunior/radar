import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthPort } from '@/application/ports';
import { extrairEmailDeJwt } from '@/infra/auth/jwt-utils';

type AuthEstado =
  | { status: 'carregando' }
  | { status: 'autenticado'; token: string; email: string | null }
  | { status: 'nao_autenticado' };

interface AuthContextValor {
  estado: AuthEstado;
  login(): Promise<void>;
  logout(): Promise<void>;
  obterToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValor | null>(null);

export function useAuth(): AuthContextValor {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}

interface AuthProviderProps {
  authGateway: AuthPort;
  children: ReactNode;
}

export function AuthProvider({ authGateway, children }: AuthProviderProps) {
  const [estado, setEstado] = useState<AuthEstado>({ status: 'carregando' });

  useEffect(() => {
    const init = async () => {
      const url = new URL(window.location.href);
      const temCallback = url.searchParams.has('code') && url.searchParams.has('state');

      if (temCallback) {
        try {
          await authGateway.processarCallback();
          window.history.replaceState({}, '', window.location.pathname);
        } catch {
          setEstado({ status: 'nao_autenticado' });
          return;
        }
      }

      const token = await authGateway.obterToken();
      if (token) {
        setEstado({ status: 'autenticado', token, email: extrairEmailDeJwt(token) });
      } else {
        setEstado({ status: 'nao_autenticado' });
      }
    };
    void init();
  }, [authGateway]);

  const valor: AuthContextValor = {
    estado,
    login: async () => {
      await authGateway.iniciarLogin();
      const token = await authGateway.obterToken();
      if (token) setEstado({ status: 'autenticado', token, email: extrairEmailDeJwt(token) });
    },
    logout: async () => {
      await authGateway.encerrarSessao();
      setEstado({ status: 'nao_autenticado' });
    },
    obterToken: () => authGateway.obterToken(),
  };

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}
