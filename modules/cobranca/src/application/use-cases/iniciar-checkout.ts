import type { TenantId } from '@radar/kernel';
import { PlanoComercialNaoEncontradoError } from '../../domain/errors/index.js';
import type { PagamentoGateway, PlanoComercialCatalogo } from '../ports.js';

export interface IniciarCheckoutInput {
  tenantId: TenantId;
  planoCodigo: string;
}

export interface IniciarCheckoutOutput {
  urlCheckout: string;
}

/**
 * POST /api/checkout/iniciar (RAD-264) — abre o checkout hospedado do gateway
 * (`PagamentoGateway.abrirCheckoutHospedado`, RAD-249) para o plano escolhido.
 * Só devolve a URL: o retorno do checkout NÃO ativa nada (P-107 (6)) — ativação
 * continua exclusiva do webhook `invoice.paid` (RAD-250).
 *
 * De propósito NÃO há um `ConsultarStatusCheckoutUseCase`/rota de status
 * (decisão de arquitetura, RAD-256/RAD-264): a tela "pagamento em processamento"
 * resolve o limbo fazendo polling de `ConsultarAssinaturaUseCase` até
 * `estado = 'ativa'` — o nosso agregado é a fonte de verdade, nunca o gateway no
 * caminho síncrono.
 */
export class IniciarCheckoutUseCase {
  constructor(
    private readonly planos: PlanoComercialCatalogo,
    private readonly gateway: PagamentoGateway,
  ) {}

  async executar(input: IniciarCheckoutInput, signal: AbortSignal): Promise<IniciarCheckoutOutput> {
    const plano = await this.planos.porCodigo(input.planoCodigo, signal);
    if (!plano) throw new PlanoComercialNaoEncontradoError(input.planoCodigo);

    const urlCheckout = await this.gateway.abrirCheckoutHospedado(plano, input.tenantId, signal);
    return { urlCheckout };
  }
}
