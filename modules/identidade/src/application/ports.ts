import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';
import type { AtribuicaoPapel, UsuarioId } from '../domain/atribuicao-papel.js';
import type { DomainEvent } from './events.js';

export interface PerfilRepository {
  porClienteFinal(tenantId: TenantId, clienteFinalId: ClienteFinalId, signal: AbortSignal): Promise<PerfilHabilitacao | null>;
  salvar(perfil: PerfilHabilitacao, signal: AbortSignal): Promise<void>;
}

export interface PerfilIdProvider {
  gerar(): PerfilId;
}

/** Publicação de eventos de domínio na fila (Published Language — A03 §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/** Fonte da atribuição de papel do usuário (docs/14 §6, P-52). No Now: adapter seed/provisionado. */
export interface PermissaoRepository {
  buscarPorUsuario(usuarioId: UsuarioId, opts: { signal: AbortSignal }): Promise<AtribuicaoPapel | null>;
}
