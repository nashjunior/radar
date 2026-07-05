/**
 * Adapter de autenticação via Amazon Cognito (Authorization Code + PKCE).
 * Usa oidc-client-ts para gerenciar tokens, renovação silenciosa e callback.
 *
 * O BFF valida o ID token (que carrega custom:tenantId) — por isso retornamos
 * id_token e não access_token (A08 §3, docs/98 P-08/P-91).
 *
 * Em produção, VITE_COGNITO_AUTHORITY aponta para o User Pool do ambiente.
 * Em dev, use DevAuthGateway com VITE_DEV_AUTH_TOKEN (requer modo dev do BFF).
 */
import { UserManager, type UserManagerSettings } from 'oidc-client-ts';
import type { AuthPort } from '@/application/ports';

export interface CognitoOidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
}

export class CognitoOidcGateway implements AuthPort {
  private readonly manager: UserManager;

  constructor(config: CognitoOidcConfig) {
    const settings: UserManagerSettings = {
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope ?? 'openid profile email',
      response_type: 'code',
      automaticSilentRenew: true,
      filterProtocolClaims: true,
    };
    this.manager = new UserManager(settings);
  }

  async obterToken(): Promise<string | null> {
    const user = await this.manager.getUser();
    if (!user || user.expired) return null;
    return user.id_token ?? null;
  }

  async iniciarLogin(): Promise<void> {
    await this.manager.signinRedirect();
  }

  async encerrarSessao(): Promise<void> {
    await this.manager.signoutRedirect();
  }

  async processarCallback(): Promise<void> {
    await this.manager.signinRedirectCallback();
  }
}
