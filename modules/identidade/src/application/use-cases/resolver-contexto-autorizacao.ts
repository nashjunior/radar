import { AcessoNegadoError } from '@radar/kernel';
import type { TenantId } from '@radar/kernel';
import type { UsuarioId } from '../../domain/atribuicao-papel.js';
import { contextoAutorizacaoParaDTO } from '../dtos.js';
import type { ContextoAutorizacaoDTO } from '../dtos.js';
import type { PermissaoRepository } from '../ports.js';

export interface ResolverContextoAutorizacaoInput {
  readonly usuarioId: UsuarioId;
  readonly tenantId: TenantId;
}

/**
 * Resolve o contexto de autorização do usuário (docs/14 §6, P-52).
 * Papel nunca vem do token — é lido de PermissaoRepository, chaveado pelo `sub` verificado.
 * Invariante duro: sem atribuição ⇒ AcessoNegadoError; atribuição de outro tenant ⇒
 * AcessoNegadoError. O tenantId do claim verificado sempre manda, nunca o do registro.
 */
export class ResolverContextoAutorizacaoUseCase {
  constructor(private readonly permissoes: PermissaoRepository) {}

  async executar(input: ResolverContextoAutorizacaoInput, signal: AbortSignal): Promise<ContextoAutorizacaoDTO> {
    const atribuicao = await this.permissoes.buscarPorUsuario(input.usuarioId, { signal });
    if (!atribuicao) throw new AcessoNegadoError();
    if (atribuicao.tenantId !== input.tenantId) throw new AcessoNegadoError();
    return contextoAutorizacaoParaDTO(atribuicao);
  }
}
