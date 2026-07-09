/**
 * Auth de desenvolvimento: usa token estático configurado em VITE_DEV_AUTH_TOKEN.
 *
 * Requer que o BFF esteja rodando com AUTH_MODE=dev e AUTH_DEV_SECRET
 * compatível (modo dev do BFF — docs/98 P-91, RAD-51).
 * NUNCA usar em staging/produção.
 */
import type { AuthPort } from '@/application/ports';

export class DevAuthGateway implements AuthPort {
  private ativo = true;

  constructor(private readonly token: string) {}

  async obterToken(): Promise<string | null> {
    return this.ativo && this.token ? this.token : null;
  }

  async iniciarLogin(): Promise<void> {
    this.ativo = true;
    console.warn('[DevAuthGateway] Token estático — use apenas local/dev com AUTH_MODE=dev no BFF.');
  }

  async encerrarSessao(): Promise<void> {
    this.ativo = false;
    console.warn('[DevAuthGateway] sessão local encerrada em modo dev.');
  }

  async processarCallback(): Promise<void> {
    // No-op: dev não usa fluxo OIDC.
  }
}
