/**
 * Stubs in-memory para Identidade & Organização.
 *
 * Usado enquanto os adapters Postgres não existem. PerfilRepository retorna null
 * em leituras; salvar é no-op. idProvider usa crypto.randomUUID(). EventPublisher
 * é o stub compartilhado de matching.
 *
 * Refs: arquitetura/17 §4.3, docs/14 §6.
 */

import { PerfilId } from '@radar/kernel';
import type { PerfilIdProvider, PerfilRepository } from '@radar/identidade';

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
