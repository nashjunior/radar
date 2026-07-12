import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import { PagamentoGatewayIndisponivelError } from '../../domain/errors/index.js';
import { FakePagamentoGateway } from '../../infra/adapters/fake-pagamento-gateway.js';

const TENANT = TenantId('tenant-001');
const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 10, precoCentavos: 9900 });

describe('FakePagamentoGateway', () => {
  it('criarClienteDeCobranca devolve um ID opaco', async () => {
    const gateway = new FakePagamentoGateway();
    const id = await gateway.criarClienteDeCobranca(
      { tenantId: TENANT, razaoSocial: 'Empresa LTDA', cpfCnpj: '00000000000191', email: 'a@b.com' },
      new AbortController().signal,
    );
    expect(id).toMatch(/^fake_cus_/);
  });

  it('abrirCheckoutHospedado devolve só a URL — o retorno do checkout NÃO ativa nada', async () => {
    const gateway = new FakePagamentoGateway();
    const url = await gateway.abrirCheckoutHospedado(plano, TENANT, new AbortController().signal);
    expect(url).toContain('checkout.fake.local');
    expect(url).toContain('plano=starter');

    const id = url.split('/').pop()!.split('?')[0]!;
    const status = await gateway.consultarAssinatura(id, new AbortController().signal);
    expect(status).toEqual({ statusExterno: 'pending', proximoVencimento: null });
  });

  it('simularPagamentoConfirmado ativa a assinatura (equivalente ao webhook invoice.paid, RAD-250)', async () => {
    const gateway = new FakePagamentoGateway();
    const url = await gateway.abrirCheckoutHospedado(plano, TENANT, new AbortController().signal);
    const id = url.split('/').pop()!.split('?')[0]!;

    gateway.simularPagamentoConfirmado(id);
    const status = await gateway.consultarAssinatura(id, new AbortController().signal);
    expect(status?.statusExterno).toBe('active');
  });

  it('consultarAssinatura devolve null para ID desconhecido', async () => {
    const gateway = new FakePagamentoGateway();
    const status = await gateway.consultarAssinatura('desconhecido', new AbortController().signal);
    expect(status).toBeNull();
  });

  it('cancelarAssinatura muda o status consultado', async () => {
    const gateway = new FakePagamentoGateway();
    const url = await gateway.abrirCheckoutHospedado(plano, TENANT, new AbortController().signal);
    const id = url.split('/').pop()!.split('?')[0]!;

    await gateway.cancelarAssinatura(id, new AbortController().signal);
    const status = await gateway.consultarAssinatura(id, new AbortController().signal);
    expect(status?.statusExterno).toBe('cancelled');
  });

  it('cancelarAssinatura de ID desconhecido lança PagamentoGatewayIndisponivelError', async () => {
    const gateway = new FakePagamentoGateway();
    await expect(
      gateway.cancelarAssinatura('desconhecido', new AbortController().signal),
    ).rejects.toThrow(PagamentoGatewayIndisponivelError);
  });

  it('respeita o AbortSignal', async () => {
    const gateway = new FakePagamentoGateway();
    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway.criarClienteDeCobranca(
        { tenantId: TENANT, razaoSocial: 'Empresa LTDA', cpfCnpj: '00000000000191', email: 'a@b.com' },
        controller.signal,
      ),
    ).rejects.toThrow(/abortada/);
  });
});
