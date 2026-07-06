/**
 * Container de DI para o front.
 * Compõe use cases com gateways concretos e expõe authGateway para o AuthProvider.
 *
 * Seleção de auth:
 *   - VITE_DEV_AUTH_TOKEN definido → DevAuthGateway (dev local sem Cognito real)
 *   - Cognito vars definidas       → CognitoOidcGateway (produção/staging)
 * O gateway de triagem usa TriagemHttpGateway apontando para VITE_API_URL.
 * O gateway de matching usa MatchingHttpGateway apontando para VITE_API_URL.
 */
import { GetTriagemUseCase } from '@/application/use-cases/get-triagem';
import { GetEditalUseCase } from '@/application/use-cases/get-edital';
import { DefinirCriterioUseCase } from '@/application/use-cases/definir-criterio';
import { RegistrarFeedbackUseCase } from '@/application/use-cases/registrar-feedback';
import { TriagemHttpGateway } from '@/infra/api/triagem-http-gateway';
import { MatchingHttpGateway } from '@/infra/api/matching-http-gateway';
import { EditalStubGateway } from '@/infra/api/edital-stub-gateway';
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

const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

const triagemGateway = new TriagemHttpGateway(apiBase, () => authGateway.obterToken());
const matchingGateway = new MatchingHttpGateway(apiBase, () => authGateway.obterToken());
const editalGateway = new EditalStubGateway();

export const useCases = {
  getTriagem: new GetTriagemUseCase(triagemGateway),
  getEdital: new GetEditalUseCase(editalGateway),
  definirCriterio: new DefinirCriterioUseCase(matchingGateway),
  registrarFeedback: new RegistrarFeedbackUseCase(matchingGateway),
} as const;

export type UseCases = typeof useCases;
