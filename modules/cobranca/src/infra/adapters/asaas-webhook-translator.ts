import type { ComandoPagamento } from '../../application/dtos.js';

/**
 * Traduz o payload cru do webhook da Asaas para o vocabulário PRÓPRIO de
 * `ComandoPagamento` (P-107 (5)/(6), RAD-250) — "tipo do provedor morre no
 * adapter": nenhum campo do Asaas (`event`, `payment.status`, ...) cruza para
 * `application`. Payload é dado NÃO CONFIÁVEL (nunca é autoridade) — qualquer
 * forma inesperada devolve `null` (ignorado pela rota, sem lançar), nunca lança.
 *
 * [A VALIDAR] Mapeamento best-effort contra o catálogo de eventos publicamente
 * documentado da Asaas (developers.asaas.com/docs/webhooks) — mesmo `[A VALIDAR]`
 * já registrado no `AsaasPagamentoGateway` (RAD-249); confirmar antes de operar
 * contra produção.
 */
const EVENTOS_PAGAMENTO_CONFIRMADO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const EVENTOS_PAGAMENTO_FALHOU = new Set(['PAYMENT_OVERDUE']);
const EVENTOS_ASSINATURA_CANCELADA = new Set(['PAYMENT_DELETED', 'SUBSCRIPTION_DELETED']);

export function traduzirEventoAsaas(corpo: unknown): ComandoPagamento | null {
  if (typeof corpo !== 'object' || corpo === null) return null;

  const envelope = corpo as Record<string, unknown>;
  const eventoExternoId = envelope['id'];
  const evento = envelope['event'];
  if (typeof eventoExternoId !== 'string' || eventoExternoId.trim() === '') return null;
  if (typeof evento !== 'string') return null;

  const assinaturaExternaId = extrairAssinaturaExternaId(envelope);
  if (!assinaturaExternaId) return null;

  if (EVENTOS_PAGAMENTO_CONFIRMADO.has(evento)) {
    return { tipo: 'PagamentoConfirmado', eventoExternoId, assinaturaExternaId };
  }
  if (EVENTOS_PAGAMENTO_FALHOU.has(evento)) {
    return { tipo: 'PagamentoFalhou', eventoExternoId, assinaturaExternaId };
  }
  if (EVENTOS_ASSINATURA_CANCELADA.has(evento)) {
    return { tipo: 'AssinaturaCancelada', eventoExternoId, assinaturaExternaId };
  }
  return null; // evento fora do nosso catálogo — ignorado, não é erro
}

function extrairAssinaturaExternaId(envelope: Record<string, unknown>): string | null {
  const subscriptionDireto = envelope['subscription'];
  if (typeof subscriptionDireto === 'string' && subscriptionDireto.trim() !== '') return subscriptionDireto;

  const payment = envelope['payment'];
  if (typeof payment === 'object' && payment !== null) {
    const subscription = (payment as Record<string, unknown>)['subscription'];
    if (typeof subscription === 'string' && subscription.trim() !== '') return subscription;
  }
  return null;
}
