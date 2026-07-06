/** Erros de aplicação específicos do front (session, auth, acesso). */

export class SessaoExpiradaError extends Error {
  readonly code = 'SESSAO_EXPIRADA' as const;

  constructor() {
    super('Sessão expirada — faça login novamente.');
    this.name = 'SessaoExpiradaError';
  }
}

export class AcessoNegadoError extends Error {
  readonly code = 'ACESSO_NEGADO' as const;

  constructor() {
    super('Acesso negado.');
    this.name = 'AcessoNegadoError';
  }
}
