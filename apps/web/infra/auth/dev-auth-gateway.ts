/**
 * Auth de desenvolvimento: usa token estático configurado em VITE_DEV_AUTH_TOKEN.
 *
 * Requer que o BFF esteja rodando com COGNITO_DEV_BYPASS_TOKEN correspondente
 * (modo dev do BFF — docs/98 P-91, coordenado com Bento/RAD-43).
 * NUNCA usar em produção.
 */
import type { AuthPort } from '@/application/ports';

export class DevAuthGateway implements AuthPort {
  constructor(private readonly token: string) {}

  async obterToken(): Promise<string | null> {
    return this.token || null;
  }

  async iniciarLogin(): Promise<void> {
    console.warn('[DevAuthGateway] Token estático — configure VITE_DEV_AUTH_TOKEN e modo dev do BFF.');
  }

  async encerrarSessao(): Promise<void> {
    console.warn('[DevAuthGateway] encerrarSessao sem efeito em modo dev.');
  }

  async processarCallback(): Promise<void> {
    // No-op: dev não usa fluxo OIDC.
  }
}
