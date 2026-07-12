/**
 * Vocabulário PRÓPRIO de eventos de pagamento (P-107 (5)/(6), RAD-250) — "tipo do
 * provedor morre no adapter": `ProcessarEventoDePagamentoUseCase` só enxerga estes
 * três comandos, nunca `event`/`PAYMENT_CONFIRMED`/etc. do Asaas. `eventoExternoId`
 * é a chave de dedupe (P-107 (5), anti-replay); `assinaturaExternaId` é o único elo
 * com o nosso lado — nunca `tenantId` (esse sai de mapeamento interno, anti-IDOR).
 */
export interface ComandoPagamentoBase {
  readonly eventoExternoId: string;
  readonly assinaturaExternaId: string;
}

export interface PagamentoConfirmado extends ComandoPagamentoBase {
  readonly tipo: 'PagamentoConfirmado';
}

export interface PagamentoFalhou extends ComandoPagamentoBase {
  readonly tipo: 'PagamentoFalhou';
}

export interface AssinaturaCancelada extends ComandoPagamentoBase {
  readonly tipo: 'AssinaturaCancelada';
}

export type ComandoPagamento = PagamentoConfirmado | PagamentoFalhou | AssinaturaCancelada;
