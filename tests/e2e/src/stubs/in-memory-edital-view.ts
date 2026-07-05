import type { EditalId } from '@radar/kernel';
import type { EditalMatchingView, EditalParaMatchingDTO } from '@radar/matching';

/**
 * Stub de EditalMatchingView para E2E.
 * Simula a leitura cross-context do Catálogo pelo Matching (docs/13 §4).
 * Em produção, seria uma view PostgreSQL sobre a tabela de editais da Ingestão.
 */
export class InMemoryEditalView implements EditalMatchingView {
  private readonly store: Map<string, EditalParaMatchingDTO> = new Map();

  registrar(edital: EditalParaMatchingDTO): void {
    this.store.set(edital.id, edital);
  }

  async porId(id: EditalId, _signal: AbortSignal): Promise<EditalParaMatchingDTO | null> {
    return this.store.get(id) ?? null;
  }
}
