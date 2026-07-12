/** Erros de aplicação específicos do front (session, auth, acesso, cota). */

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

/** Lançado quando o back responde HTTP 402 — cota de triagens esgotada para o ciclo. */
export class CotaExcedidaError extends Error {
  readonly code = 'COTA_EXCEDIDA' as const;

  constructor(
    public readonly cota: number,
    public readonly usado: number,
    public readonly upgradeDisponivel: boolean,
  ) {
    super('Cota de triagens excedida.');
    this.name = 'CotaExcedidaError';
  }
}
