/**
 * Stub in-memory de TriagemRepository e ExtracaoRepository.
 *
 * Usado enquanto os adapters Postgres não existem. Permite que o servidor
 * suba e o contrato seja verificado. Retorna null para todos os lookups
 * (→ BFF 404). Quando os adapters concretos chegarem, troca-se aqui no
 * composition root (server.ts) sem alterar o use case nem a rota.
 *
 * Refs: arquitetura/17 §4.3, docs/98 P-86.
 */

import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { ExtracaoRepository, TriagemRepository } from '@radar/triagem';

export const triagemStub: TriagemRepository = {
  async porEditalEPerfil(
    _tenantId: TenantId,
    _clienteFinalId: ClienteFinalId,
    _editalId: EditalId,
    _perfilId: PerfilId,
    _signal: AbortSignal,
  ) {
    return null;
  },
  async salvar(_triagem, _signal) {
    /* sem persistência no stub */
  },
};

export const extracaoStub: ExtracaoRepository = {
  async porEdital(_editalId: EditalId, _signal: AbortSignal) {
    return null;
  },
  async salvar(_extracao, _signal) {
    /* sem persistência no stub */
  },
};
