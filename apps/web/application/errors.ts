/** Erros de aplicação específicos do front (session, auth). */

export class SessaoExpiradaError extends Error {
  readonly code = 'SESSAO_EXPIRADA' as const;

  constructor() {
    super('Sessão expirada — faça login novamente.');
    this.name = 'SessaoExpiradaError';
  }
}
