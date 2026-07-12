/**
 * Barramento de eventos em memória para testes E2E.
 * Substitui SQS no harness (A04 §4: ambiente isolado).
 *
 * Cada módulo recebe seu próprio EventPublisher tipado.
 * Os handlers são registrados via subscribe() antes de qualquer publish.
 */

type Handler = (payload: unknown, signal: AbortSignal, occurredAt: Date) => Promise<void>;

export class InMemoryEventBus {
  private readonly handlers: Map<string, Handler[]> = new Map();
  private readonly _published: Array<{ type: string; payload: unknown }> = [];

  subscribe(tipo: string, handler: Handler): void {
    const list = this.handlers.get(tipo) ?? [];
    list.push(handler);
    this.handlers.set(tipo, list);
  }

  get published(): ReadonlyArray<{ type: string; payload: unknown }> {
    return this._published;
  }

  /** EventPublisher compatível com o port de matching e notificacao. */
  asPublisher(): {
    publicar(evento: { type: string; occurredAt: Date; payload?: unknown }, signal: AbortSignal): Promise<void>;
  } {
    return {
      publicar: async (evento, signal) => {
        const payload = (evento as Record<string, unknown>)['payload'];
        this._published.push({ type: evento.type, payload });

        const list = this.handlers.get(evento.type) ?? [];
        for (const h of list) {
          await h(payload, signal, evento.occurredAt);
        }
      },
    };
  }

  reset(): void {
    this._published.length = 0;
    this.handlers.clear();
  }
}
