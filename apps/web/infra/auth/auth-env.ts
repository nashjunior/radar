const MODOS_DEV_AUTH_PERMITIDOS = new Set(['development', 'dev', 'local', 'test']);

export interface AuthEnv {
  readonly MODE?: string | undefined;
  readonly DEV?: boolean;
  readonly VITE_DEV_AUTH_TOKEN?: string | undefined;
}

function normalizarToken(token: string | undefined): string | undefined {
  const valor = token?.trim();
  return valor ? valor : undefined;
}

export function permiteDevAuth(env: AuthEnv): boolean {
  if (env.DEV === true) return true;
  const mode = env.MODE?.toLowerCase();
  return !!mode && MODOS_DEV_AUTH_PERMITIDOS.has(mode);
}

/**
 * Invariante P-91/RAD-132: o token estático de dev nunca pode entrar em build
 * de staging/prod. A mesma regra roda no Vite config (build) e no container
 * do front (runtime).
 */
export function obterDevAuthTokenSeguro(env: AuthEnv): string | undefined {
  const token = normalizarToken(env.VITE_DEV_AUTH_TOKEN);
  if (!token) return undefined;

  if (!permiteDevAuth(env)) {
    const mode = env.MODE ?? 'desconhecido';
    throw new Error(
      `VITE_DEV_AUTH_TOKEN é permitido só em modo development/dev/local/test; modo atual: ${mode}. ` +
        'Remova o token e use Cognito Hosted UI em staging/prod.',
    );
  }

  return token;
}
