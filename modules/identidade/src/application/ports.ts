import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';

export interface PerfilRepository {
  porClienteFinal(tenantId: TenantId, clienteFinalId: ClienteFinalId, signal: AbortSignal): Promise<PerfilHabilitacao | null>;
  salvar(perfil: PerfilHabilitacao, signal: AbortSignal): Promise<void>;
}

export interface PerfilIdProvider {
  gerar(): PerfilId;
}

export interface EventPublisher {
  publicar(event: { type: string; occurredAt: Date }, signal: AbortSignal): Promise<void>;
}
