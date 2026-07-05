import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

/**
 * Port de saída: repositório de triagens (implementado pela infra/).
 * A UI NUNCA chama a infra diretamente — só via use cases (A12 §2).
 */
export interface TriagemGateway {
  buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null>;
}

/**
 * Port de autenticação — implementado por CognitoOidcGateway (prod) ou DevAuthGateway (dev).
 * A UI interage via AuthProvider/useAuth; nunca acessa o gateway diretamente.
 * Refs: docs/98 P-08, P-91, arquitetura/08 §3.
 */
export interface AuthPort {
  /** Retorna o ID token JWT atual, ou null se não autenticado/expirado. */
  obterToken(): Promise<string | null>;
  /** Inicia o fluxo de login (redireciona para o Cognito Hosted UI). */
  iniciarLogin(): Promise<void>;
  /** Encerra a sessão. */
  encerrarSessao(): Promise<void>;
  /**
   * Troca o authorization code por tokens (callback do IdP).
   * Deve ser invocado quando a URL contém code= e state=.
   */
  processarCallback(): Promise<void>;
}
