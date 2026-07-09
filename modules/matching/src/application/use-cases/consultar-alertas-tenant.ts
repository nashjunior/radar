import type { TenantId } from '@radar/kernel';
import type { AlertaDTO } from '../dtos.js';
import { alertaParaDTO } from '../dtos.js';
import type { AlertaRepository, EditalCatalogoPort } from '../ports.js';

export interface ConsultarAlertasTenantInput {
  tenantId: TenantId;
}

/**
 * Lista todos os alertas gerados para o tenant autenticado (US-05).
 * Autorização por objeto: tenantId vem sempre do JWT via BFF — nunca do corpo.
 * Enriquece cada alerta com dados do Catálogo via EditalCatalogoPort (RAD-148).
 * MVP: N+1 lookups são aceitáveis; no Next substituir por view SQL (P-40).
 * Refs: docs/14 §2 (US-05), P-51 (authz por objeto), arquitetura/17 §5.3.
 */
export class ConsultarAlertasTenantUseCase {
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly catalogo: EditalCatalogoPort,
  ) {}

  async executar(input: ConsultarAlertasTenantInput, signal: AbortSignal): Promise<AlertaDTO[]> {
    const alertas = await this.alertas.listarPorTenant(input.tenantId, signal);

    return Promise.all(
      alertas.map(async (a) => {
        const base = alertaParaDTO(a);
        const edital = await this.catalogo.porId(a.editalId, signal);
        if (edital === null) return base;
        return {
          ...base,
          modalidade: edital.modalidade,
          titulo: edital.titulo,
          orgao: edital.orgao,
          valorEstimado: edital.valorEstimado,
          dataAbertura: edital.dataAbertura,
        };
      }),
    );
  }
}
