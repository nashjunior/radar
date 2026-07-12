export type EstadoAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

/**
 * Projeção de leitura do estado da assinatura do tenant (GET /api/me/assinatura).
 * Contrato ratificado em RAD-264. `usoReservado` é o medidor (gate de cota); `usoConfirmado`
 * é informativo/fatura — não some os dois. `diasRestantes` já calculado no backend; null só
 * quando `estado === 'cancelada'`.
 */
export interface AssinaturaViewModel {
  estado: EstadoAssinatura;
  plano: {
    codigo: string;
    cota: number;
  };
  usoReservado: number;
  usoConfirmado: number;
  diasRestantes: number | null;
}
