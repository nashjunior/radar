import { describe, expect, it } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, TenantId } from '@radar/kernel';
import { AutorizarAcessoUseCase } from '../../application/use-cases/autorizar-acesso.js';
import type { AutorizarAcessoInput } from '../../application/use-cases/autorizar-acesso.js';
import type { ContextoAutorizacaoDTO } from '../../application/dtos.js';
import { UsuarioId } from '../../domain/atribuicao-papel.js';

const noop = new AbortController().signal;

const TENANT = TenantId('tenant-1');
const USUARIO = UsuarioId('sub-1');
const CLIENTE_A = ClienteFinalId('cliente-a');
const CLIENTE_B = ClienteFinalId('cliente-b');

function contexto(overrides: Partial<ContextoAutorizacaoDTO>): ContextoAutorizacaoDTO {
  return {
    usuarioId: USUARIO,
    tenantId: TENANT,
    papel: 'OPERADOR',
    clienteFinalIds: [CLIENTE_A],
    ...overrides,
  };
}

describe('AutorizarAcessoUseCase', () => {
  it('nega quando a matriz não permite a ação para o papel', async () => {
    const uc = new AutorizarAcessoUseCase();
    const input: AutorizarAcessoInput = {
      contexto: contexto({ papel: 'CLIENTE_FINAL_READONLY' }),
      recurso: 'CRITERIO_MONITORAMENTO',
      acao: 'criar',
    };

    await expect(uc.executar(input, noop)).rejects.toThrow(AcessoNegadoError);
  });

  it('permite quando a matriz permite e nenhum clienteFinalId é informado', async () => {
    const uc = new AutorizarAcessoUseCase();
    const input: AutorizarAcessoInput = {
      contexto: contexto({}),
      recurso: 'TRIAGEM',
      acao: 'ler',
    };

    await expect(uc.executar(input, noop)).resolves.toBeUndefined();
  });

  it('papel em um clienteFinalId não atravessa outro (AB2)', async () => {
    const uc = new AutorizarAcessoUseCase();
    const input: AutorizarAcessoInput = {
      contexto: contexto({ papel: 'OPERADOR', clienteFinalIds: [CLIENTE_A] }),
      recurso: 'TRIAGEM',
      acao: 'ler',
      clienteFinalId: CLIENTE_B,
    };

    await expect(uc.executar(input, noop)).rejects.toThrow(AcessoNegadoError);
  });

  it('permite quando o clienteFinalId está no escopo da atribuição', async () => {
    const uc = new AutorizarAcessoUseCase();
    const input: AutorizarAcessoInput = {
      contexto: contexto({ papel: 'OPERADOR', clienteFinalIds: [CLIENTE_A] }),
      recurso: 'TRIAGEM',
      acao: 'ler',
      clienteFinalId: CLIENTE_A,
    };

    await expect(uc.executar(input, noop)).resolves.toBeUndefined();
  });

  it('ADMIN_CONSULTORIA tem escopo de tenant inteiro — clienteFinalId fora da lista não nega', async () => {
    const uc = new AutorizarAcessoUseCase();
    const input: AutorizarAcessoInput = {
      contexto: contexto({ papel: 'ADMIN_CONSULTORIA', clienteFinalIds: [] }),
      recurso: 'TRIAGEM',
      acao: 'ler',
      clienteFinalId: CLIENTE_B,
    };

    await expect(uc.executar(input, noop)).resolves.toBeUndefined();
  });
});
