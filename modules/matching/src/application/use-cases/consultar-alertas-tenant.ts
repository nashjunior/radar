import type { TenantId } from '@radar/kernel';
import type { AlertaDTO } from '../dtos.js';
import { alertaParaDTO } from '../dtos.js';
import type { AlertaRepository } from '../ports.js';

export interface ConsultarAlertasTenantInput {
  tenantId: TenantId;
}

/**
 * Lista todos os alertas gerados para o tenant autenticado (US-05).
 * Autorização por objeto: tenantId vem sempre do JWT via BFF — nunca do corpo.
 * Refs: docs/14 §2 (US-05), P-51 (authz por objeto), arquitetura/17 §5.3.
 */
export class ConsultarAlertasTenantUseCase {
  constructor(private readonly alertas: AlertaRepository) {}

  async executar(input: ConsultarAlertasTenantInput, signal: AbortSignal): Promise<AlertaDTO[]> {
    const alertas = await this.alertas.listarPorTenant(input.tenantId, signal);
    return alertas.map((a) => alertaParaDTO(a));
  }
}
