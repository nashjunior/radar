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
 *
 * Trial vencido (RAD-277, P-107 (9)) projeta `estado: 'suspensa'` — transição
 * LAZY, só nesta leitura (nunca persistida/escrita aqui, nunca por scheduler):
 * o Figma já tem a superfície `Shell · Suspensa` e o front já trata esse
 * estado (banner de conta suspensa), então reaproveita o contrato existente em
 * vez de introduzir um estado novo.
 */
export class ConsultarAssinaturaUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly clock: ClockProvider,
  ) {}

  async executar(input: ConsultarAssinaturaInput, signal: AbortSignal): Promise<AssinaturaDTO> {
    const assinatura = await this.assinaturas.porTenantId(input.tenantId, signal);
    if (!assinatura) throw new AssinaturaNaoEncontradaError(input.tenantId);

    const agora = this.clock.agora();
    const estado = assinatura.trialVencido(agora) ? 'suspensa' : assinatura.estado;

    return {
      estado,
      plano: {
        codigo: assinatura.plano.codigo,
        cota: assinatura.plano.cota.valor,
      },
      usoReservado: assinatura.usoReservado,
      usoConfirmado: assinatura.usoConfirmado,
      diasRestantes: estado === 'cancelada' ? null : diasAte(assinatura.cicloVigente.fim, agora),
    };
  }
}

function diasAte(fim: Date, agora: Date): number {
  return Math.max(Math.ceil((fim.getTime() - agora.getTime()) / MS_POR_DIA), 0);
}
