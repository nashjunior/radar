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

    executar();
    const handle = setInterval(executar, this.config.intervaloMs);
    return () => clearInterval(handle);
  }
}
