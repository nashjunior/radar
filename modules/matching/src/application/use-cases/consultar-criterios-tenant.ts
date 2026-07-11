import type { TenantId } from '@radar/kernel';
import { criterioParaDTO } from '../dtos.js';
import type { CriterioDTO } from '../dtos.js';
import { AuditoriaCriterioService } from '../services/auditoria-criterio-service.js';
import type { AuditCriterioPort, CriterioRepository } from '../ports.js';

export interface ConsultarCriteriosTenantInput {
  /** tenantId do JWT autenticado — nunca do body (P-51). */
  readonly tenantId: TenantId;
}

/**
 * Lista critérios de monitoramento ativos do tenant autenticado.
 * CRITERIO_MONITORAMENTO é classe crítica (docs/05 §9): toda leitura é auditada
 * de forma append-only, fail-closed (AB13/P-61). Falha na auditoria bloqueia a leitura.
 *
 * Refs: docs/05 §9, P-61, AB13, arquitetura/17 §5.3 (authz por objeto).
 */
export class ConsultarCriteriosTenantUseCase {
  private readonly auditoria: AuditoriaCriterioService;

  constructor(
    private readonly criterios: CriterioRepository,
    audit: AuditCriterioPort,
  ) {
    this.auditoria = new AuditoriaCriterioService(audit);
  }

  async executar(
    input: ConsultarCriteriosTenantInput,
    signal: AbortSignal,
  ): Promise<CriterioDTO[]> {
    // Auditoria de leitura fail-closed ANTES de retornar dados (AB13/P-61).
    // Se a trilha de auditoria não puder gravar, a leitura é bloqueada.
    await this.auditoria.registrarFailClosed(
      {
        operadorId: input.tenantId,
        recurso: `criterio-monitoramento:tenant:${input.tenantId}`,
        acao: 'LER',
        baseLegal: 'Lei 14.133/2021 art. 174 — monitoramento de licitações',
        escopo: { tenantId: input.tenantId },
      },
      signal,
    );

    const criterios = await this.criterios.listarPorTenant(input.tenantId, signal);
    return criterios.map(criterioParaDTO);
  }
}
