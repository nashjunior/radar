import type { EditalId } from '@radar/kernel';
import { AnexoAprovado, AnexoRejeitado } from '../events.js';
import type {
  AnexoEditalRepository,
  AnexoScanner,
  EventPublisher,
} from '../ports.js';

export interface EscanearAnexoInput {
  editalId: EditalId;
  nomeAnexo: string;
  storageKey: string;
}

/**
 * Worker que processa o resultado do scan AV/malware de um anexo em quarentena.
 * Trigger: evento `AnexoQuarentenado` (P-104, AB14, padrão P-96 item 4).
 *
 * Transições:
 *   pendente → limpo  : scan limpo → emite AnexoAprovado
 *   pendente → rejeitado : ameaça detectada → emite AnexoRejeitado
 *
 * Falha do scanner: estado permanece `pendente` (isolado, sem promoção).
 * O worker deve ser idempotente — reprocesso de anexo já escaneado é no-op.
 */
export class EscanearAnexoUseCase {
  constructor(
    private readonly scanner: AnexoScanner,
    private readonly anexoRepo: AnexoEditalRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async executar(input: EscanearAnexoInput, signal: AbortSignal): Promise<void> {
    const todos = await this.anexoRepo.listarPorEdital(input.editalId, signal);
    const anexo = todos.find((a) => a.nome === input.nomeAnexo);

    if (!anexo) return;
    if (anexo.estadoConfianca !== 'pendente') return;

    const resultado = await this.scanner.escanear(anexo.storageKey, signal);

    await this.anexoRepo.atualizarEstado(
      input.editalId,
      input.nomeAnexo,
      resultado,
      signal,
    );

    if (resultado === 'limpo') {
      await this.eventPublisher.publicar(
        new AnexoAprovado({ editalId: input.editalId, nomeAnexo: input.nomeAnexo }),
        signal,
      );
    } else {
      await this.eventPublisher.publicar(
        new AnexoRejeitado({ editalId: input.editalId, nomeAnexo: input.nomeAnexo }),
        signal,
      );
    }
  }
}
