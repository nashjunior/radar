import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

/**
 * Port de saída: repositório de triagens (implementado pela infra/).
 * A UI NUNCA chama a infra diretamente — só via use cases (A12 §2).
 */
export interface TriagemGateway {
  buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null>;
}
