/**
 * Stubs in-memory para Identidade & Organização.
 *
 * Usado enquanto os adapters Postgres não existem. PerfilRepository retorna null
 * em leituras; salvar é no-op. idProvider usa crypto.randomUUID(). EventPublisher
 * é o stub compartilhado de matching.
 *
 * `tenantRepositoryStub` (RAD-285) É stateful — precisa sobreviver ao processo
 * para que `POST /api/organizacoes` provisione e `PermissaoConfigAdapter`
 * (também mutável, ver `permissao-config-adapter.ts`) reconheça a atribuição
 * na mesma instância usada por `/api/me`/`exigirOrganizacaoMiddleware`/RBAC —
 * por isso é um singleton de módulo, construído aqui e importado por
 * `server.ts`, nunca reconstruído por request.
 *
 * Refs: arquitetura/17 §4.3, docs/14 §6.
 */

import { PerfilId, TenantId } from '@radar/kernel';
import { OrganizacaoJaExisteError } from '@radar/identidade';
import type { Cnpj, PerfilIdProvider, PerfilRepository, Tenant, TenantIdProvider, TenantRepository } from '@radar/identidade';

export const perfilRepositoryStub: PerfilRepository = {
  async porClienteFinal(_tenantId, _clienteFinalId, _signal) {
    return null;
  },
  async salvar(_perfil, _signal) {
    /* sem persistência no stub */
  },
};

export const perfilIdProviderStub: PerfilIdProvider = {
  gerar() {
    return PerfilId(crypto.randomUUID());
  },
};

class InMemoriaTenantRepository implements TenantRepository {
  private readonly porIdMapa = new Map<string, Tenant>();
  private readonly porCnpjMapa = new Map<string, Tenant>();

  async porId(tenantId: ReturnType<typeof TenantId>, _signal: AbortSignal): Promise<Tenant | null> {
    return this.porIdMapa.get(tenantId) ?? null;
  }

  async porCnpj(cnpj: Cnpj, _signal: AbortSignal): Promise<Tenant | null> {
    return this.porCnpjMapa.get(cnpj.valor) ?? null;
  }

  async salvar(tenant: Tenant, _signal: AbortSignal): Promise<void> {
    if (this.porCnpjMapa.has(tenant.cnpj.valor)) throw new OrganizacaoJaExisteError();
    this.porIdMapa.set(tenant.id, tenant);
    this.porCnpjMapa.set(tenant.cnpj.valor, tenant);
  }
}

export const tenantRepositoryStub: TenantRepository = new InMemoriaTenantRepository();

export const tenantIdProviderStub: TenantIdProvider = {
  gerar() {
    return TenantId(crypto.randomUUID());
  },
};
