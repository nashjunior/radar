import type {
  ArquivoBaixado,
  ArquivoPncpData,
  ContratacaoData,
  PncpGateway,
  PncpIdentificadorCompra,
} from '../../application/ports.js';
import type { CircuitBreaker } from './circuit-breaker.js';

/**
 * Decora um `PncpGateway` com o `CircuitBreaker` (arq/04 §7 — "circuit breakers nas
 * integrações externas"). Cada chamada de rede passa por `breaker.executar`; breaker
 * aberto lança `BreakerAbertoError`, que o `PncpPollingScheduler` já captura para
 * degradar o ciclo com graça (arq/04 §6) em vez de derrubar o produto.
 *
 * Os métodos que retornam `AsyncGenerator` protegem cada página (`.next()`), não o
 * generator inteiro — do contrário uma falha na página 3 nunca contaria como falha
 * (o `for await` do use case só chama `.next()` sob demanda).
 */
export class CircuitBreakerPncpGateway implements PncpGateway {
  constructor(
    private readonly inner: PncpGateway,
    private readonly breaker: CircuitBreaker,
  ) {}

  async *buscarContratacoesPorPublicacao(
    modalidade: number,
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    const paginas = this.inner.buscarContratacoesPorPublicacao(modalidade, janela, signal);
    for (;;) {
      const proximo = await this.breaker.executar(() => paginas.next(), signal);
      if (proximo.done) return;
      yield proximo.value;
    }
  }

  async *buscarContratacoesPorAtualizacao(
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<ContratacaoData[]> {
    const paginas = this.inner.buscarContratacoesPorAtualizacao(janela, signal);
    for (;;) {
      const proximo = await this.breaker.executar(() => paginas.next(), signal);
      if (proximo.done) return;
      yield proximo.value;
    }
  }

  async buscarContratacaoPorNumero(
    identificador: PncpIdentificadorCompra,
    signal: AbortSignal,
  ): Promise<ContratacaoData | null> {
    return this.breaker.executar(
      () => this.inner.buscarContratacaoPorNumero(identificador, signal),
      signal,
    );
  }

  async buscarArquivos(
    identificador: PncpIdentificadorCompra,
    signal: AbortSignal,
  ): Promise<ArquivoPncpData[]> {
    return this.breaker.executar(() => this.inner.buscarArquivos(identificador, signal), signal);
  }

  async downloadArquivo(urlOrigem: string, signal: AbortSignal): Promise<ArquivoBaixado> {
    return this.breaker.executar(() => this.inner.downloadArquivo(urlOrigem, signal), signal);
  }
}
