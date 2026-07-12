import type { TenantId } from '@radar/kernel';
import { PagamentoGatewayIndisponivelError } from '../../domain/errors/index.js';
import type { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import type {
  DadosClienteCobranca,
  PagamentoGateway,
  StatusAssinaturaExterna,
} from '../../application/ports.js';

/** [A VALIDAR] Confirmar contra a doc oficial da Asaas (developers.asaas.com) antes de operar
 * contra produção — payload/endpoints abaixo são best-effort pela API v3 publicamente documentada;
 * "Bloqueio de produção (não bloqueia o código)" da issue RAD-249 cobre exatamente este ponto. */
const BASE_URL_PRODUCAO = 'https://api.asaas.com/v3';
const BASE_URL_SANDBOX = 'https://sandbox.asaas.com/api/v3';

export interface AsaasPagamentoGatewayConfig {
  /** Chave da API Asaas — injetada pelo composition root a partir do Secrets Manager (P-08);
   * NUNCA hardcoded, NUNCA em `.env` versionado. */
  readonly apiKey: string;
  /** `true` enquanto vendor/DPA não fecham (P-107 (a)) — roda contra o sandbox da Asaas. */
  readonly sandbox: boolean;
}

/**
 * ACL do gateway Asaas (P-107 (a), default de GTM) — implementa `PagamentoGateway` no padrão do
 * `AnthropicLlmGateway`/A10 §4.6: verbos do nosso domínio aqui, tecnologia do provedor só neste
 * arquivo. Nenhum tipo cru do HTTP/SDK da Asaas cruza para `application`/`domain` — a resposta é
 * traduzida no ponto de retorno de cada método; falha de transporte vira sempre
 * `PagamentoGatewayIndisponivelError`. Minimização (docs/05 §9): o corpo enviado carrega só KYC do
 * PRÓPRIO tenant, plano e IDs opacos — nunca `editalId`/`perfilId`/nome de cliente-final.
 */
export class AsaasPagamentoGateway implements PagamentoGateway {
  private readonly baseUrl: string;

  constructor(private readonly config: AsaasPagamentoGatewayConfig) {
    this.baseUrl = config.sandbox ? BASE_URL_SANDBOX : BASE_URL_PRODUCAO;
  }

  async criarClienteDeCobranca(dados: DadosClienteCobranca, signal: AbortSignal): Promise<string> {
    const resposta = await this.chamar(
      '/customers',
      {
        method: 'POST',
        body: {
          name: dados.razaoSocial,
          cpfCnpj: dados.cpfCnpj,
          email: dados.email,
          externalReference: dados.tenantId,
        },
      },
      signal,
    );
    return campoTextoObrigatorio(resposta, 'id');
  }

  async abrirCheckoutHospedado(
    plano: PlanoComercial,
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<string> {
    // [A VALIDAR] endpoint de checkout hospedado multi-forma de pagamento (cartão/PIX/boleto) da
    // Asaas — confirmar o payload exato (`/checkouts`) contra a doc oficial antes de produção.
    const resposta = await this.chamar(
      '/checkouts',
      {
        method: 'POST',
        body: {
          billingTypes: ['CREDIT_CARD', 'PIX', 'BOLETO'],
          chargeTypes: ['RECURRENT'],
          externalReference: tenantId,
          subscription: {
            cycle: 'MONTHLY',
            value: plano.precoCentavos / 100,
            description: `Radar de Licitações — plano ${plano.codigo}`,
          },
        },
      },
      signal,
    );
    return campoTextoObrigatorio(resposta, 'link');
  }

  async consultarAssinatura(
    assinaturaExternaId: string,
    signal: AbortSignal,
  ): Promise<StatusAssinaturaExterna | null> {
    const resposta = await this.chamar(
      `/subscriptions/${encodeURIComponent(assinaturaExternaId)}`,
      { method: 'GET' },
      signal,
      { permiteNaoEncontrado: true },
    );
    if (resposta === null) return null;
    const proximoVencimento = resposta['nextDueDate'];
    return {
      statusExterno: String(resposta['status']),
      proximoVencimento: typeof proximoVencimento === 'string' ? new Date(proximoVencimento) : null,
    };
  }

  async cancelarAssinatura(assinaturaExternaId: string, signal: AbortSignal): Promise<void> {
    await this.chamar(
      `/subscriptions/${encodeURIComponent(assinaturaExternaId)}`,
      { method: 'DELETE' },
      signal,
    );
  }

  private async chamar(
    path: string,
    init: { readonly method: string; readonly body?: unknown },
    signal: AbortSignal,
    opts?: { readonly permiteNaoEncontrado?: boolean },
  ): Promise<Record<string, unknown> | null> {
    let resposta: Response;
    try {
      resposta = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { 'content-type': 'application/json', access_token: this.config.apiKey },
        body: init.body ? JSON.stringify(init.body) : null,
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new PagamentoGatewayIndisponivelError('Asaas', (err as Error).message);
    }

    if (opts?.permiteNaoEncontrado && resposta.status === 404) return null;
    if (!resposta.ok) {
      throw new PagamentoGatewayIndisponivelError('Asaas', `HTTP ${resposta.status}`);
    }
    if (resposta.status === 204) return {};
    return (await resposta.json()) as Record<string, unknown>;
  }
}

function campoTextoObrigatorio(resposta: Record<string, unknown> | null, campo: string): string {
  const v = resposta?.[campo];
  if (typeof v !== 'string' || v.length === 0) {
    throw new PagamentoGatewayIndisponivelError('Asaas', `resposta sem campo "${campo}"`);
  }
  return v;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
