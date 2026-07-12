import { DomainError, type TenantId } from '@radar/kernel';
import type { Assinatura } from '../../domain/entities/assinatura.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type { ComandoPagamento } from '../dtos.js';
import type {
  AssinaturaRepository,
  AuditoriaWebhookPagamentoPort,
  PagamentoGateway,
  WebhookEventoRepository,
} from '../ports.js';

const PROVEDOR = 'asaas';

/**
 * Estados do provedor que confirmam pagamento ativo, normalizados no ponto de uso
 * (`StatusAssinaturaExterna.statusExterno` é o valor cru do provedor — RAD-249; a
 * normalização por gateway migra para dentro de cada adapter quando um segundo
 * provedor existir, P-66). [A VALIDAR] confirmar o enum de status da Asaas
 * (developers.asaas.com) antes de operar contra produção — mesmo `[A VALIDAR]` do
 * `AsaasPagamentoGateway`.
 */
const ESTADOS_CONFIRMADOS = new Set(['active', 'ACTIVE']);

/**
 * Processa um comando de pagamento já traduzido do vocabulário do provedor (RAD-250,
 * P-107 (5)/(6)) — o webhook é GATILHO, nunca AUTORIDADE:
 *
 * 1. Dedupe pelo `eventoExternoId` — replay/reentrega vira no-op (`executar` retorna
 *    sem tocar no agregado).
 * 2. `tenantId` só sai do mapeamento interno `assinaturaExternaId -> Assinatura`
 *    (nunca do payload) — `assinaturaExterna` desconhecida é descartada e logada,
 *    NUNCA cria uma Assinatura nova (anti-IDOR).
 * 3. `PagamentoConfirmado` exige CONFIRMAÇÃO OUTBOUND: só ativa se uma chamada
 *    autenticada `PagamentoGateway.consultarAssinatura` confirmar o pagamento — um
 *    evento forjado ou repetido não é capaz, sozinho, de conceder entitlement.
 * 4. Toda decisão (inclusive descarte) é auditada fail-closed (docs/05 §4) — é
 *    dinheiro e acesso.
 */
export class ProcessarEventoDePagamentoUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly webhookEventos: WebhookEventoRepository,
    private readonly gateway: PagamentoGateway,
    private readonly auditoria: AuditoriaWebhookPagamentoPort,
  ) {}

  async executar(comando: ComandoPagamento, signal: AbortSignal): Promise<void> {
    const primeiraEntrega = await this.webhookEventos.registrarSePrimeiraVez(
      PROVEDOR,
      comando.eventoExternoId,
      signal,
    );
    if (!primeiraEntrega) return; // replay/reentrega — no-op, nunca reprocessa

    try {
      await this.processar(comando, signal);
    } catch (err) {
      // Falha DEPOIS do claim (infra de auditoria indisponível, erro ao persistir a
      // transição) — desfaz o dedupe para que a reentrega do provedor (at-least-once)
      // tente de novo, em vez de perder o evento silenciosamente para sempre.
      await this.webhookEventos.desfazerRegistro(PROVEDOR, comando.eventoExternoId, signal).catch(() => {});
      throw err;
    }
  }

  private async processar(comando: ComandoPagamento, signal: AbortSignal): Promise<void> {
    const assinatura = await this.assinaturas.porAssinaturaExternaId(comando.assinaturaExternaId, signal);
    if (!assinatura) {
      await this.auditar(comando, null, 'DESCARTADO_ASSINATURA_EXTERNA_DESCONHECIDA', signal);
      return; // anti-IDOR: nunca cria nada a partir de um assinaturaExternaId que não é nosso
    }

    switch (comando.tipo) {
      case 'PagamentoConfirmado': {
        const status = await this.gateway.consultarAssinatura(comando.assinaturaExternaId, signal);
        if (!status || !ESTADOS_CONFIRMADOS.has(status.statusExterno)) {
          await this.auditar(comando, assinatura.tenantId, 'NAO_ATIVADO_CONFIRMACAO_OUTBOUND_FALHOU', signal);
          return; // payload sem autoridade: sem confirmação do gateway, não ativa
        }
        await this.aplicarTransicao(
          comando,
          assinatura.tenantId,
          () => assinatura.ativar(comando.assinaturaExternaId),
          'ATIVADA',
          signal,
        );
        return;
      }
      case 'PagamentoFalhou':
        await this.aplicarTransicao(
          comando,
          assinatura.tenantId,
          () => assinatura.marcarInadimplente(),
          'MARCADA_INADIMPLENTE',
          signal,
        );
        return;
      case 'AssinaturaCancelada':
        await this.aplicarTransicao(
          comando,
          assinatura.tenantId,
          () => assinatura.cancelar(),
          'CANCELADA',
          signal,
        );
        return;
    }
  }

  /**
   * Transições de ciclo de vida podem chegar fora de ordem (reentrega tardia,
   * cancelamento manual de suporte que já mudou o estado) — `DomainError` de
   * transição inválida vira no-op auditado, não 5xx: o webhook não deve entrar em
   * loop de retry do provedor por causa de uma transição que o nosso agregado já
   * não permite.
   */
  private async aplicarTransicao(
    comando: ComandoPagamento,
    tenantId: TenantId,
    transicao: () => Assinatura,
    decisaoSucesso: string,
    signal: AbortSignal,
  ): Promise<void> {
    let resultado: Assinatura;
    try {
      resultado = transicao();
    } catch (err) {
      if (err instanceof DomainError) {
        await this.auditar(comando, tenantId, 'IGNORADO_TRANSICAO_INVALIDA', signal);
        return;
      }
      throw err;
    }
    await this.assinaturas.salvar(resultado, signal);
    await this.auditar(comando, tenantId, decisaoSucesso, signal);
  }

  private async auditar(
    comando: ComandoPagamento,
    tenantId: TenantId | null,
    decisao: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.auditoria.registrar(
        {
          eventoExternoId: comando.eventoExternoId,
          assinaturaExternaId: comando.assinaturaExternaId,
          tenantId,
          decisao,
        },
        signal,
      );
    } catch {
      throw new AuditoriaIndisponivelError();
    }
  }
}
