import type { TenantId } from '@radar/kernel';
import type { DigestDTO } from '../../application/dtos.js';
import type { EnviarDigestUseCase } from '../../application/use-cases/enviar-digest.js';
import type { UsuarioId } from '../../domain/entities/notificacao.js';

export interface DigestSchedulerDestinatario {
  usuarioId: UsuarioId;
  tenantId: TenantId;
  emailDestinatario: string;
}

export interface DigestSchedulerConfig {
  destinatarios: readonly DigestSchedulerDestinatario[];
  intervaloMs: number;
  tamanhoJanelaMs: number;
  agora?: () => Date;
  aoFalhar?: (erro: unknown) => void;
}

/**
 * Scheduler de digest para o composition root de Notificacao.
 * Preferencia, cap anti-fadiga e envio ficam no use case; aqui so ha wiring temporal abortavel.
 */
export class DigestScheduler {
  private readonly agora: () => Date;

  constructor(
    private readonly enviarDigest: Pick<EnviarDigestUseCase, 'executar'>,
    private readonly config: DigestSchedulerConfig,
  ) {
    this.agora = config.agora ?? (() => new Date());
  }

  async executarCiclo(signal: AbortSignal): Promise<DigestDTO[]> {
    const fim = this.agora();
    const inicio = new Date(fim.getTime() - this.config.tamanhoJanelaMs);
    const resultados: DigestDTO[] = [];

    for (const destinatario of this.config.destinatarios) {
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
