export type StatusAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

/** Projeção de leitura do estado da assinatura do tenant (GET /api/me/assinatura). */
export interface AssinaturaViewModel {
  plano: string;
  status: StatusAssinatura;
  cota: number;
  usado: number;
  restante: number;
  cicloFim: string;
  trialTerminaEm?: string;
}
