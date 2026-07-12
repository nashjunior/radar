import { AcessoNegadoError } from '@radar/kernel';
import type { TenantId } from '@radar/kernel';
import type { UsuarioId } from '../../domain/atribuicao-papel.js';
import { SemOrganizacaoError } from '../../domain/errors.js';
import { contextoAutorizacaoParaDTO } from '../dtos.js';
import type { ContextoAutorizacaoDTO } from '../dtos.js';
import type { PermissaoRepository } from '../ports.js';

export interface ResolverContextoAutorizacaoInput {
  readonly usuarioId: UsuarioId;
  /**
   * `custom:tenantId` do token, só quando presente (contas de `AdminCreateUser`,
   * RAD-283) — cross-check, nunca fonte de verdade. `null`/ausente é o caso normal
   * do self-signup: a claim não existe até `ProvisionarOrganizacaoUseCase` rodar.
   */
  readonly tenantClaim?: TenantId | null;
}

/**
 * Resolve o contexto de autorização do usuário (docs/14 §6, P-52, RAD-283).
 * Papel e `tenantId` nunca vêm do token — são lidos de `PermissaoRepository`,
 * chaveado pelo `sub` verificado; o `tenantId` da resposta é o do NOSSO banco.
 * Invariantes: sem atribuição ⇒ `SemOrganizacaoError` (estado "sem organização",
 * não acesso negado cego — direciona ao onboarding); `tenantClaim` presente e
 * divergente do registro ⇒ `AcessoNegadoError`.
 */
export class ResolverContextoAutorizacaoUseCase {
  constructor(private readonly permissoes: PermissaoRepository) {}

  async executar(input: ResolverContextoAutorizacaoInput, signal: AbortSignal): Promise<ContextoAutorizacaoDTO> {
    const atribuicao = await this.permissoes.buscarPorUsuario(input.usuarioId, { signal });
    if (!atribuicao) throw new SemOrganizacaoError();
    if (input.tenantClaim && atribuicao.tenantId !== input.tenantClaim) throw new AcessoNegadoError();
    return contextoAutorizacaoParaDTO(atribuicao);
  }
}
