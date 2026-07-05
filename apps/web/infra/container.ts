/**
 * Container de DI para o front.
 * Compõe use cases com gateways concretos e expõe authGateway para o AuthProvider.
 *
 * Seleção de auth:
 *   - VITE_DEV_AUTH_TOKEN definido → DevAuthGateway (dev local sem Cognito real)
 *   - Cognito vars definidas       → CognitoOidcGateway (produção/staging)
 * O gateway de triagem usa TriagemHttpGateway apontando para VITE_API_URL.
 */
import { GetTriagemUseCase } from '@/application/use-cases/get-triagem';
import { TriagemHttpGateway } from '@/infra/api/triagem-http-gateway';
import { CognitoOidcGateway } from '@/infra/auth/cognito-oidc-gateway';
import { DevAuthGateway } from '@/infra/auth/dev-auth-gateway';
import type { AuthPort } from '@/application/ports';

const devToken = import.meta.env['VITE_DEV_AUTH_TOKEN'] as string | undefined;

const cognitoScope = import.meta.env['VITE_COGNITO_SCOPE'] as string | undefined;

export const authGateway: AuthPort = devToken
  ? new DevAuthGateway(devToken)
  : new CognitoOidcGateway({
      authority: import.meta.env['VITE_COGNITO_AUTHORITY'] as string,
      clientId: import.meta.env['VITE_COGNITO_CLIENT_ID'] as string,
      redirectUri: (import.meta.env['VITE_COGNITO_REDIRECT_URI'] as string | undefined) ?? window.location.origin,
      ...(cognitoScope ? { scope: cognitoScope } : {}),
    });

const triagemGateway = new TriagemHttpGateway(
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? '',
  () => authGateway.obterToken(),
);

export const useCases = {
  getTriagem: new GetTriagemUseCase(triagemGateway),
} as const;

export type UseCases = typeof useCases;
