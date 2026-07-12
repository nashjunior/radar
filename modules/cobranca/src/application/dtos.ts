import type { EstadoAssinatura } from '../domain/entities/assinatura.js';

/**
 * Leitura do agregado Assinatura — GET /api/me/assinatura (RAD-264, contrato
 * prometido à Flávia em RAD-251/RAD-256). `usoReservado` é o medidor: mesma
 * grandeza que o gate compara (`uso_reservado < cota`, RAD-246). `usoConfirmado`
 * é fatura, nunca gate — os dois NÃO se colapsam num campo "usado" (o front decide
 * o que exibir). `diasRestantes` deriva de `cicloVigente.fim`; `null` apenas em
 * `cancelada` (sem ciclo futuro a contar) — no trial é o que a tela mostra
 * ("8 dias restantes").
 */
export interface AssinaturaDTO {
  readonly estado: EstadoAssinatura;
  readonly plano: {
    readonly codigo: string;
    readonly cota: number;
  };
  readonly usoReservado: number;
  readonly usoConfirmado: number;
  readonly diasRestantes: number | null;
}

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
