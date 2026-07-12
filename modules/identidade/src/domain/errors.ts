import { DomainError } from '@radar/kernel';

/** CNPJ malformado ou com dígito verificador inválido (RAD-285). */
export class CnpjInvalidoError extends DomainError {
  readonly code = 'CNPJ_INVALIDO' as const;
  constructor(motivo: string) {
    super(`CNPJ inválido: ${motivo}`);
  }
}

/**
 * O CNPJ informado já está vinculado a outro Tenant (unicidade 1 CNPJ = 1 tenant,
 * P-109 L3 — higiene cadastral, não anti-Sybil: não barra o múltiplo real).
 */
export class OrganizacaoJaExisteError extends DomainError {
  readonly code = 'ORGANIZACAO_JA_EXISTE' as const;
  constructor() {
    super('já existe uma organização cadastrada para este CNPJ');
  }
}

/**
 * O `sub` já tem uma `AtribuicaoPapel` — sinal de conflito na escrita (constraint
 * UNIQUE), usado pelo adapter para que `ProvisionarOrganizacaoUseCase` trate como
 * idempotência (devolve a organização existente) em vez de duplicar.
 */
export class UsuarioJaVinculadoError extends DomainError {
  readonly code = 'USUARIO_JA_VINCULADO' as const;
  constructor() {
    super('usuário já vinculado a uma organização');
  }
}

/**
 * Sessão autenticada (sub verificado) sem `AtribuicaoPapel` — não é acesso negado
 * cego, é o estado "sem organização" que direciona ao onboarding (RAD-283/RAD-285,
 * docs/14 §6). Distinto de `AcessoNegadoError` (que cobre divergência de tenant).
 */
export class SemOrganizacaoError extends DomainError {
  readonly code = 'SEM_ORGANIZACAO' as const;
  constructor() {
    super('usuário autenticado sem organização provisionada');
  }
}
