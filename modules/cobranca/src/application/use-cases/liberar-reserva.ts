import type { TenantId } from '@radar/kernel';
import type { AssinaturaRepository } from '../ports.js';

export interface LiberarReservaInput {
  tenantId: TenantId;
}

/**
 * Compensação da reserva no caminho de falha (P-107 (c)) — decrementa
 * `uso_reservado` sem nunca deixá-lo negativo. Chamada pelo middleware
 * `entitlement` (apps/api) quando a requisição síncrona que reservou a cota não
 * termina em `triagem.solicitada` publicado (editalId inválido, perfil não
 * encontrado, falha de publish) — sem isso a cota vaza e o gate passa a barrar um
 * tenant que não consumiu nada.
 */
export class LiberarReservaUseCase {
  constructor(private readonly assinaturas: AssinaturaRepository) {}

  async executar(input: LiberarReservaInput, signal: AbortSignal): Promise<void> {
    await this.assinaturas.liberarReserva(input.tenantId, signal);
  }
}
