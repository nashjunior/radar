import { randomUUID } from 'node:crypto';
import type { TenantId } from '@radar/kernel';
import { PagamentoGatewayIndisponivelError } from '../../domain/errors/index.js';
import type { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import type {
  DadosClienteCobranca,
  PagamentoGateway,
  StatusAssinaturaExterna,
} from '../../application/ports.js';

interface AssinaturaFake {
  status: 'pending' | 'active' | 'cancelled';
}

/**
 * Adapter fake em memória (RAD-249, DoD) — o resto do sistema (use cases, testes,
 * dev local) não pode depender do Asaas real estar de pé. Sem rede, determinístico;
 * IDs opacos gerados localmente só para satisfazer o contrato do port.
 *
 * `abrirCheckoutHospedado` nasce `pending` — fiel à regra de que o retorno do
 * checkout NÃO ativa nada (P-107 (6)): só `simularPagamentoConfirmado` (chamado
 * pelo TESTE, nunca pelo port) reproduz o que o webhook `invoice.paid` faria
 * (RAD-250, ainda não implementado).
 */
export class FakePagamentoGateway implements PagamentoGateway {
  private readonly clientes = new Map<string, DadosClienteCobranca>();
  private readonly assinaturas = new Map<string, AssinaturaFake>();

  async criarClienteDeCobranca(dados: DadosClienteCobranca, signal: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const id = `fake_cus_${randomUUID()}`;
    this.clientes.set(id, dados);
    return id;
  }

  async abrirCheckoutHospedado(
    plano: PlanoComercial,
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal);
    const id = `fake_sub_${randomUUID()}`;
    this.assinaturas.set(id, { status: 'pending' });
    return `https://checkout.fake.local/${id}?plano=${plano.codigo}&tenant=${tenantId}`;
  }

  async consultarAssinatura(
    assinaturaExternaId: string,
    signal: AbortSignal,
  ): Promise<StatusAssinaturaExterna | null> {
    throwIfAborted(signal);
    const a = this.assinaturas.get(assinaturaExternaId);
    if (!a) return null;
    return { statusExterno: a.status, proximoVencimento: null };
  }

  async cancelarAssinatura(assinaturaExternaId: string, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const a = this.assinaturas.get(assinaturaExternaId);
    if (!a) throw new PagamentoGatewayIndisponivelError('Fake', 'assinatura não encontrada');
    a.status = 'cancelled';
  }

  /** Só para setup de teste/dev — simula o que o webhook `invoice.paid` faria (RAD-250). */
  simularPagamentoConfirmado(assinaturaExternaId: string): void {
    const a = this.assinaturas.get(assinaturaExternaId);
    if (!a) throw new PagamentoGatewayIndisponivelError('Fake', 'assinatura não encontrada');
    a.status = 'active';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('operação abortada', 'AbortError');
}
