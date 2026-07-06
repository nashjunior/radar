/**
 * Stubs in-memory para o contexto Notificação.
 *
 * Usados enquanto os adapters Postgres não estão disponíveis.
 * Substituir no composition root (server.ts) sem alterar use cases nem rotas.
 */

import type { PreferenciaRepository } from '@radar/notificacao';
import type { PreferenciaDTO } from '@radar/notificacao';

export const preferenciaStub: PreferenciaRepository = {
  async porUsuario(_id, _signal) {
    return null;
  },
  async salvar(_preferencia: PreferenciaDTO, _signal: AbortSignal) {
    /* sem persistência no stub */
  },
};
