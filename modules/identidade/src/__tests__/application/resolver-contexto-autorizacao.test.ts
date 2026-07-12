import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, TenantId } from '@radar/kernel';
import { ResolverContextoAutorizacaoUseCase } from '../../application/use-cases/resolver-contexto-autorizacao.js';
import type { ResolverContextoAutorizacaoInput } from '../../application/use-cases/resolver-contexto-autorizacao.js';
import type { PermissaoRepository } from '../../application/ports.js';
import { AtribuicaoPapel, UsuarioId } from '../../domain/atribuicao-papel.js';
import { SemOrganizacaoError } from '../../domain/errors.js';

const noop = new AbortController().signal;

const TENANT = TenantId('tenant-1');
const USUARIO = UsuarioId('sub-1');
const CLIENTE = ClienteFinalId('cliente-1');

const INPUT: ResolverContextoAutorizacaoInput = { usuarioId: USUARIO, tenantClaim: TENANT };

const ATRIBUICAO = AtribuicaoPapel.criar({
  usuarioId: USUARIO,
  tenantId: TENANT,
  papel: 'OPERADOR',
  clienteFinalIds: [CLIENTE],
});

function deps(atribuicao: AtribuicaoPapel | null) {
  const buscarPorUsuario = vi.fn().mockResolvedValue(atribuicao);
  const criar = vi.fn().mockResolvedValue(undefined);
  const permissoes: PermissaoRepository = { buscarPorUsuario, criar };
  return { permissoes, buscarPorUsuario };
}

describe('ResolverContextoAutorizacaoUseCase', () => {
  it('resolve o ContextoAutorizacaoDTO a partir da atribuição encontrada', async () => {
    const { permissoes } = deps(ATRIBUICAO);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    const dto = await uc.executar(INPUT, noop);

    expect(dto).toEqual({
      usuarioId: USUARIO,
      tenantId: TENANT,
      papel: 'OPERADOR',
      clienteFinalIds: [CLIENTE],
    });
  });

  it('resolve mesmo sem tenantClaim (self-signup, sem custom:tenantId no token)', async () => {
    const { permissoes } = deps(ATRIBUICAO);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    const dto = await uc.executar({ usuarioId: USUARIO }, noop);

    expect(dto.tenantId).toBe(TENANT);
  });

  it('sem atribuição para o usuário lança SemOrganizacaoError (estado "sem organização", não acesso negado cego)', async () => {
    const { permissoes, buscarPorUsuario } = deps(null);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(SemOrganizacaoError);
    expect(buscarPorUsuario).toHaveBeenCalledWith(USUARIO, { signal: noop });
  });

  it('nega quando o tenantClaim (custom:tenantId presente) diverge do tenantId da atribuição', async () => {
    const atribuicaoOutroTenant = AtribuicaoPapel.criar({
      usuarioId: USUARIO,
      tenantId: TenantId('outro-tenant'),
      papel: 'OPERADOR',
      clienteFinalIds: [CLIENTE],
    });
    const { permissoes } = deps(atribuicaoOutroTenant);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
  });

  it('propaga o AbortSignal para a porta (P-78)', async () => {
    const { permissoes, buscarPorUsuario } = deps(ATRIBUICAO);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    await uc.executar(INPUT, noop);

    expect(buscarPorUsuario).toHaveBeenCalledWith(USUARIO, { signal: noop });
  });
});
