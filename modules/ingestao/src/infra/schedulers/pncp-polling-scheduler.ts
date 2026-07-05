import type { IngerirEditaisUseCase } from '../../application/use-cases/ingerir-editais.js';
import type { IngestaoResumoDTO } from '../../application/dtos.js';

export interface PncpPollingSchedulerConfig {
  modalidades: readonly number[];
  intervaloMs: number;
  tamanhoJanelaMs: number;
  agora?: () => Date;
  aoFalhar?: (erro: unknown) => void;
}

/**
 * Scheduler de polling PNCP para o composition root da Ingestao.
 * A coleta/minimizacao/upsert/proveniencia seguem no gateway e no use case; aqui so ha wiring abortavel.
 */
export class PncpPollingScheduler {
  private readonly agora: () => Date;

  constructor(
    private readonly ingerirEditais: Pick<IngerirEditaisUseCase, 'executar'>,
    private readonly config: PncpPollingSchedulerConfig,
  ) {
    if (config.modalidades.length === 0) {
      throw new RangeError('modalidades não pode ser vazio');
    }
    if (!Number.isFinite(config.intervaloMs) || config.intervaloMs <= 0) {
      throw new RangeError('intervaloMs deve ser > 0 e finito');
    }
    if (!Number.isFinite(config.tamanhoJanelaMs) || config.tamanhoJanelaMs <= 0) {
      throw new RangeError('tamanhoJanelaMs deve ser > 0 e finito');
    }
    this.agora = config.agora ?? (() => new Date());
  }

  async executarCiclo(signal: AbortSignal): Promise<IngestaoResumoDTO[]> {
    const fim = this.agora();
    const inicio = new Date(fim.getTime() - this.config.tamanhoJanelaMs);
    const resultados: IngestaoResumoDTO[] = [];

    for (const modalidade of this.config.modalidades) {
      signal.throwIfAborted();
      resultados.push(
        await this.ingerirEditais.executar(
          {
            modalidade,
            janela: { inicio, fim },
          },
          signal,
        ),
      );
    }

    return resultados;
  }

  iniciar(signal: AbortSignal): () => void {
    const executar = (): void => {
      if (signal.aborted) return;
      void this.executarCiclo(signal).catch((erro: unknown) => {
        if (!signal.aborted) this.config.aoFalhar?.(erro);
      });
    };

    if (signal.aborted) return () => {};

    executar();
    const handle = setInterval(executar, this.config.intervaloMs);
    const limpar = (): void => {
      clearInterval(handle);
      signal.removeEventListener('abort', limpar);
    };
    signal.addEventListener('abort', limpar, { once: true });
    return limpar;
  }
}
