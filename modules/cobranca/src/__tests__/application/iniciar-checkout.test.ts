import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { IniciarCheckoutUseCase } from '../../application/use-cases/iniciar-checkout.js';
import { PlanoComercialNaoEncontradoError } from '../../domain/errors/index.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const TENANT = TenantId('tenant-001');
const noop = new AbortController().signal;

function makePlanos(plano: PlanoComercial | null) {
  return { porCodigo: vi.fn().mockResolvedValue(plano) };
}

function makeGateway(url: string) {
  return {
    criarClienteDeCobranca: vi.fn(),
    abrirCheckoutHospedado: vi.fn().mockResolvedValue(url),
    consultarAssinatura: vi.fn(),
    cancelarAssinatura: vi.fn(),
  };
}

describe('IniciarCheckoutUseCase', () => {
  it('lança PlanoComercialNaoEncontradoError quando planoCodigo não existe no catálogo', async () => {
    const uc = new IniciarCheckoutUseCase(makePlanos(null), makeGateway('https://checkout.fake/x'));
    await expect(
      uc.executar({ tenantId: TENANT, planoCodigo: 'inexistente' }, noop),
    ).rejects.toThrow(PlanoComercialNaoEncontradoError);
  });

  it('abre o checkout hospedado e devolve só a urlCheckout', async () => {
    const plano = PlanoComercial.criar({ codigo: 'pro', cotaTriagensMes: 150, precoCentavos: 39900 });
    const gateway = makeGateway('https://checkout.fake/abc123');
    const uc = new IniciarCheckoutUseCase(makePlanos(plano), gateway);

    const resultado = await uc.executar({ tenantId: TENANT, planoCodigo: 'pro' }, noop);

    expect(resultado).toEqual({ urlCheckout: 'https://checkout.fake/abc123' });
    expect(gateway.abrirCheckoutHospedado).toHaveBeenCalledExactlyOnceWith(plano, TENANT, noop);
  });
});
