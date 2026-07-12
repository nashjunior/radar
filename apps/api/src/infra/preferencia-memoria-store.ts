/**
 * Persistência em memória das preferências de notificação (demo local).
 */

import type { PreferenciaDTO, PreferenciaRepository } from '@radar/notificacao';

export function criarPreferenciaMemoriaStore(): PreferenciaRepository {
  const map = new Map<string, PreferenciaDTO>();

  return {
    async porUsuario(id, signal) {
      signal.throwIfAborted();
      return map.get(id) ?? null;
    },
    async salvar(preferencia, signal) {
      signal.throwIfAborted();
      map.set(preferencia.usuarioId, preferencia);
    },
  };
}
