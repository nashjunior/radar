import type { EstadoBreaker } from '../../application/events.js';
import { PipelineBreakerEstadoMudou } from '../../application/events.js';
import { BreakerAbertoError } from '../../domain/errors/index.js';
import type { EventPublisher } from '../../application/ports.js';

export type { EstadoBreaker };

/**
 * Configuração dos limiares de um circuit breaker (P-34, arq/04 §7).
 * Todos os campos são obrigatórios para forçar decisão explícita nos composition roots.
 */
export interface CircuitBreakerConfig {
  /** Identificador do breaker (ex.: 'PNCP', 'LLM', 'CUSTO'). */
  nome: string;
  /** Falhas consecutivas necessárias para abrir o breaker. */
  limiarFalhas: number;
  /** Milissegundos em ABERTO antes de tentar sonda em MEIO_ABERTO. */
  timeoutAberturaMs: number;
  /** Sucessos consecutivos em MEIO_ABERTO para fechar o breaker. */
  limiarSucessosSonda: number;
}

/**
 * Circuit breaker de três estados: FECHADO → ABERTO → MEIO_ABERTO → FECHADO.
 *
 * Transições emitem `PipelineBreakerEstadoMudou` (P-15) quando um publisher
 * for fornecido. O estado é in-memory; persistência e alarmes são responsabilidade
 * do consumidor (Source-Health Monitor, arq/04 §5).
 *
 * Degradação graciosa (arq/04 §6): breaker aberto lança `BreakerAbertoError`;
 * o chamador deve capturar e servir o estado atual sem tocar na fonte.
 */
export class CircuitBreaker {
  private estado: EstadoBreaker = 'FECHADO';
  private contadorFalhas = 0;
  private contadorSucessosSonda = 0;
  private aberturaEm: number | null = null;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly eventos?: Pick<EventPublisher, 'publicar'>,
    private readonly agora: () => number = () => Date.now(),
  ) {
    if (config.limiarFalhas <= 0) throw new RangeError('limiarFalhas deve ser > 0');
    if (config.timeoutAberturaMs <= 0) throw new RangeError('timeoutAberturaMs deve ser > 0');
    if (config.limiarSucessosSonda <= 0) throw new RangeError('limiarSucessosSonda deve ser > 0');
  }

  get estadoAtual(): EstadoBreaker {
    return this.estado;
  }

  get nome(): string {
    return this.config.nome;
  }

  /**
   * Executa `fn` com proteção do breaker.
   *
   * - FECHADO: executa normalmente; falha incrementa contador.
   * - ABERTO: rejeita imediatamente com `BreakerAbertoError`, salvo se o
   *   `timeoutAberturaMs` expirou — nesse caso transiciona para MEIO_ABERTO e sonda.
   * - MEIO_ABERTO: executa `fn`; sucesso avança sonda; falha reabre.
   */
  async executar<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();

    if (this.estado === 'ABERTO') {
      if (
        this.aberturaEm !== null &&
        this.agora() - this.aberturaEm >= this.config.timeoutAberturaMs
      ) {
        this.transicionarPara('MEIO_ABERTO', signal);
      } else {
        throw new BreakerAbertoError(this.config.nome);
      }
    }

    try {
      const resultado = await fn();
      this.onSucesso(signal);
      return resultado;
    } catch (err) {
      if (err instanceof BreakerAbertoError) throw err;
      this.onFalha(signal);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private onSucesso(signal: AbortSignal): void {
    if (this.estado === 'MEIO_ABERTO') {
      this.contadorSucessosSonda++;
      if (this.contadorSucessosSonda >= this.config.limiarSucessosSonda) {
        this.contadorFalhas = 0;
        this.contadorSucessosSonda = 0;
        this.aberturaEm = null;
        this.transicionarPara('FECHADO', signal);
      }
    } else {
      this.contadorFalhas = 0;
    }
  }

  private onFalha(signal: AbortSignal): void {
    if (this.estado === 'MEIO_ABERTO') {
      this.contadorSucessosSonda = 0;
      this.transicionarPara('ABERTO', signal);
    } else {
      this.contadorFalhas++;
      if (this.contadorFalhas >= this.config.limiarFalhas) {
        this.transicionarPara('ABERTO', signal);
      }
    }
  }

  private transicionarPara(novo: EstadoBreaker, signal: AbortSignal): void {
    const anterior = this.estado;
    this.estado = novo;

    if (novo === 'ABERTO') {
      this.aberturaEm = this.agora();
    }

    if (this.eventos) {
      void this.eventos.publicar(
        new PipelineBreakerEstadoMudou({
          breaker: this.config.nome,
          estadoAnterior: anterior,
          estadoAtual: novo,
          contadorFalhas: this.contadorFalhas,
        }),
        signal,
      );
    }
  }
}
