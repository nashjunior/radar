import type { ClienteFinalId } from '@radar/kernel';
import type { ClienteFinalDTO, ClienteFinalGateway } from '@radar/notificacao';

/**
 * Stub de ClienteFinalGateway para E2E.
 * MVP: 1 usuário por clienteFinal (P-25).
 */
export class InMemoryClienteFinalGateway implements ClienteFinalGateway {
  private readonly store: Map<string, ClienteFinalDTO> = new Map();

  registrar(clienteFinalId: string, dto: ClienteFinalDTO): void {
    this.store.set(clienteFinalId, dto);
  }

  async porId(id: ClienteFinalId, _signal: AbortSignal): Promise<ClienteFinalDTO | null> {
    return this.store.get(id) ?? null;
  }
}
