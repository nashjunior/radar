import type { TenantId } from '@radar/kernel';
import type { DigestDTO } from '../../application/dtos.js';
import type { EnviarDigestUseCase } from '../../application/use-cases/enviar-digest.js';
import type { UsuarioId } from '../../domain/entities/notificacao.js';

export type FrequenciaDigest = 'DIARIA' | 'SEMANAL';

export interface DigestSchedulerDestinatario {
  usuarioId: UsuarioId;
  tenantId: TenantId;
  emailDestinatario: string;
}

/** Ciclo de uma frequência — janela e cadência próprias (RAD-207 §7: DIARIA e SEMANAL não podem compartilhar janela). */
export interface DigestSchedulerCiclo {
  destinatarios: readonly DigestSchedulerDestinatario[];
  intervaloMs: number;
  tamanhoJanelaMs: number;
}

export interface DigestSchedulerConfig {
  ciclos: Record<FrequenciaDigest, DigestSchedulerCiclo>;
  agora?: () => Date;
  aoFalhar?: (erro: unknown) => void;
}

/**
 * Scheduler de digest para o composition root de Notificacao.
 * Preferencia, cap anti-fadiga e envio ficam no use case; aqui so ha wiring temporal abortavel.
 * DIARIA e SEMANAL rodam como ciclos independentes — cada um com sua propria janela e
 * intervalo — porque uma janela global faria o usuario semanal ver so as ultimas 24h (P-81).
 */
export class DigestScheduler {
  private readonly agora: () => Date;

  constructor(
    private readonly enviarDigest: Pick<EnviarDigestUseCase, 'executar'>,
    private readonly config: DigestSchedulerConfig,
  ) {
    this.agora = config.agora ?? (() => new Date());
  }

  async executarCiclo(frequencia: FrequenciaDigest, signal: AbortSignal): Promise<DigestDTO[]> {
    const ciclo = this.config.ciclos[frequencia];
    const fim = this.agora();
    const inicio = new Date(fim.getTime() - ciclo.tamanhoJanelaMs);
    const resultados: DigestDTO[] = [];

    for (const destinatario of ciclo.destinatarios) {
      signal.throwIfAborted();
      resultados.push(
        await this.enviarDigest.executar(
          {
            usuarioId: destinatario.usuarioId,
            tenantId: destinatario.tenantId,
            emailDestinatario: destinatario.emailDestinatario,
            janela: { inicio },
          },
          signal,
        ),
      );
    }

    return resultados;
  }

  iniciar(signal: AbortSignal): () => void {
    const frequencias: readonly FrequenciaDigest[] = ['DIARIA', 'SEMANAL'];
    const paradas = frequencias.map(frequencia => {
      const executar = (): void => {
        if (signal.aborted) return;
        void this.executarCiclo(frequencia, signal).catch((erro: unknown) => {
          if (!signal.aborted) this.config.aoFalhar?.(erro);
        });
      };

      executar();
      const handle = setInterval(executar, this.config.ciclos[frequencia].intervaloMs);
      return () => clearInterval(handle);
    });

    return () => paradas.forEach(parar => parar());
  }
}
