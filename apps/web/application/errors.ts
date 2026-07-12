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

/** Lançado quando GET /api/me responde 403 { code: 'SEM_ORGANIZACAO' } — usuário autenticado sem tenant. */
export class SemOrganizacaoError extends Error {
  readonly code = 'SEM_ORGANIZACAO' as const;

  constructor() {
    super('Usuário autenticado sem organização vinculada.');
    this.name = 'SemOrganizacaoError';
  }
}

/** Lançado quando POST /api/organizacoes responde com { code: 'CNPJ_INVALIDO' }. */
export class CnpjInvalidoError extends Error {
  readonly code = 'CNPJ_INVALIDO' as const;

  constructor() {
    super('CNPJ inválido — verifique os dígitos e tente novamente.');
    this.name = 'CnpjInvalidoError';
  }
}

/** Lançado quando POST /api/organizacoes responde com { code: 'ORGANIZACAO_JA_EXISTE' }. */
export class OrganizacaoJaExisteError extends Error {
  readonly code = 'ORGANIZACAO_JA_EXISTE' as const;

  constructor() {
    super('Este CNPJ já está vinculado a outra conta. Solicite acesso ao responsável pela conta.');
    this.name = 'OrganizacaoJaExisteError';
  }
}
