import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';
import type { AtribuicaoPapel, UsuarioId } from '../domain/atribuicao-papel.js';

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

/** Fonte da atribuição de papel do usuário (docs/14 §6, P-52). No Now: adapter seed/provisionado. */
export interface PermissaoRepository {
  buscarPorUsuario(usuarioId: UsuarioId, opts: { signal: AbortSignal }): Promise<AtribuicaoPapel | null>;
}
