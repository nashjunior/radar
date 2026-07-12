import type { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import type { PerfilHabilitacao } from '../domain/perfil-habilitacao.js';
import type { AtribuicaoPapel, UsuarioId } from '../domain/atribuicao-papel.js';
import type { Tenant } from '../domain/tenant.js';
import type { Cnpj } from '../domain/value-objects/cnpj.js';
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

/**
 * Fonte da atribuição de papel do usuário (docs/14 §6, P-52). `criar` é usado só por
 * `ProvisionarOrganizacaoUseCase` (RAD-285) — a implementação deve lançar
 * `UsuarioJaVinculadoError` quando o `sub` já tem atribuição (constraint UNIQUE),
 * nunca sobrescrever: é o sinal que torna o provisionamento idempotente.
 */
export interface PermissaoRepository {
  buscarPorUsuario(usuarioId: UsuarioId, opts: { signal: AbortSignal }): Promise<AtribuicaoPapel | null>;
  criar(atribuicao: AtribuicaoPapel, signal: AbortSignal): Promise<void>;
}

/**
 * Repositório do agregado Tenant (docs/13 §3, RAD-285). `salvar` deve lançar
 * `OrganizacaoJaExisteError` em conflito de unicidade (1 CNPJ = 1 tenant, constraint
 * UNIQUE, P-109 L3) — higiene de cadastro, não defesa anti-Sybil.
 */
export interface TenantRepository {
  porId(tenantId: TenantId, signal: AbortSignal): Promise<Tenant | null>;
  porCnpj(cnpj: Cnpj, signal: AbortSignal): Promise<Tenant | null>;
  salvar(tenant: Tenant, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs únicos para `Tenant`. Injetado na infra para isolabilidade (mesmo padrão de `PerfilIdProvider`). */
export interface TenantIdProvider {
  gerar(): TenantId;
}
