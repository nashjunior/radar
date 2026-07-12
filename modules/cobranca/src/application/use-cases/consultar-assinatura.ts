import type { TenantId } from '@radar/kernel';
import { AssinaturaNaoEncontradaError } from '../../domain/errors/index.js';
import type { AssinaturaDTO } from '../dtos.js';
import type { AssinaturaRepository, ClockProvider } from '../ports.js';

export interface ConsultarAssinaturaInput {
  tenantId: TenantId;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Leitura do agregado Assinatura para GET /api/me/assinatura (RAD-264) — sem
 * regra de negócio própria, só projeta `Assinatura` no `AssinaturaDTO` (docs/13
 * §3). `diasRestantes` é `null` em `cancelada` (não há ciclo futuro a contar);
 * nos demais estados deriva de `cicloVigente.fim` — no trial é o que a tela
 * mostra ("8 dias restantes").
 */
export class ConsultarAssinaturaUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly clock: ClockProvider,
  ) {}

  async executar(input: ConsultarAssinaturaInput, signal: AbortSignal): Promise<AssinaturaDTO> {
    const assinatura = await this.assinaturas.porTenantId(input.tenantId, signal);
    if (!assinatura) throw new AssinaturaNaoEncontradaError(input.tenantId);

    return {
      estado: assinatura.estado,
      plano: {
        codigo: assinatura.plano.codigo,
        cota: assinatura.plano.cota.valor,
      },
      usoReservado: assinatura.usoReservado,
      usoConfirmado: assinatura.usoConfirmado,
      diasRestantes:
        assinatura.estado === 'cancelada'
          ? null
          : diasAte(assinatura.cicloVigente.fim, this.clock.agora()),
    };
  }
}

function diasAte(fim: Date, agora: Date): number {
  return Math.max(Math.ceil((fim.getTime() - agora.getTime()) / MS_POR_DIA), 0);
}
