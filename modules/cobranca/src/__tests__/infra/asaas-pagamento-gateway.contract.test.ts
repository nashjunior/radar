import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { PagamentoGatewayIndisponivelError } from '../../domain/errors/index.js';
import { AsaasPagamentoGateway } from '../../infra/adapters/asaas-pagamento-gateway.js';

/**
 * Teste de CONTRATO contra o sandbox real da Asaas (DoD RAD-249) — não roda sem
 * `ASAAS_API_KEY` (chave de sandbox). Ambiente sem a credencial faz o suite
 * inteiro pular (não falhar) — mesmo tratamento de outros testes credenciados do
 * repositório (ex. gold set de Triagem sob `ANTHROPIC_API_KEY`, docs/98). Rodar
 * localmente/CI com a chave exportada para validar o `[A VALIDAR]` do adapter
 * contra a API real antes de qualquer promoção a produção.
 */
const apiKey = process.env['ASAAS_API_KEY'];

describe.skipIf(!apiKey)('AsaasPagamentoGateway (contrato — sandbox)', () => {
  const gateway = new AsaasPagamentoGateway({ apiKey: apiKey ?? '', sandbox: true });

  it('criarClienteDeCobranca cria um cliente real no sandbox e devolve um ID', async () => {
    const id = await gateway.criarClienteDeCobranca(
      {
        tenantId: TenantId('tenant-contrato'),
        razaoSocial: 'Radar de Licitações — teste de contrato',
        cpfCnpj: '24971563792',
        email: 'contrato-rad249@radar-de-licitacoes.test',
      },
      new AbortController().signal,
    );
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('consultarAssinatura devolve null (404) para um ID inexistente', async () => {
    const status = await gateway.consultarAssinatura('sub_inexistente_rad249', new AbortController().signal);
    expect(status).toBeNull();
  });

  it('cancelarAssinatura de um ID inexistente lança PagamentoGatewayIndisponivelError', async () => {
    await expect(
      gateway.cancelarAssinatura('sub_inexistente_rad249', new AbortController().signal),
    ).rejects.toThrow(PagamentoGatewayIndisponivelError);
  });
});
