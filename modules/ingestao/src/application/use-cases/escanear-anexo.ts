import type { EditalId } from '@radar/kernel';
import { AnexoAprovado, AnexoRejeitado } from '../events.js';
import type {
  AnexoEditalRepository,
  AnexoScanner,
  EventPublisher,
  ExtratorDeTexto,
  ObjectStorage,
} from '../ports.js';

export interface EscanearAnexoInput {
  editalId: EditalId;
  sequencialDocumento: number;
  storageKey: string;
}

/**
 * Worker que processa o resultado do scan AV/malware de um anexo em quarentena.
 * Trigger: evento `AnexoQuarentenado` (P-104, AB14, padrão P-96 item 4).
 *
 * Transições:
 *   pendente → limpo  : scan limpo → extrai texto (`textoKey`/`paginas`) → emite AnexoAprovado
 *   pendente → rejeitado : ameaça detectada → emite AnexoRejeitado (nunca abre o binário)
 *
 * A extração só roda DEPOIS do `limpo` (P-104/AB14, P-110/RAD-280): o parser multi-formato
 * (`ExtratorDeTexto`) nunca toca bytes que ainda não passaram pelo scanner — um anexo rejeitado
 * nunca chega a ser aberto por ele.
 *
 * Falha do scanner OU da extração: estado permanece `pendente` (isolado, sem promoção).
 * O worker deve ser idempotente — reprocesso de anexo já escaneado é no-op.
 */
export class EscanearAnexoUseCase {
  constructor(
    private readonly scanner: AnexoScanner,
    private readonly anexoRepo: AnexoEditalRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly objectStorage: ObjectStorage,
    private readonly extrator: ExtratorDeTexto,
  ) {}

  async executar(input: EscanearAnexoInput, signal: AbortSignal): Promise<void> {
    const todos = await this.anexoRepo.listarPorEdital(input.editalId, signal);
    const anexo = todos.find((a) => a.sequencialDocumento === input.sequencialDocumento);

    if (!anexo) return;
    if (anexo.estadoConfianca !== 'pendente') return;

    const resultado = await this.scanner.escanear(anexo.storageKey, signal);

    if (resultado === 'limpo') {
      const conteudo = await this.objectStorage.obter(anexo.storageKey, signal);
      const extraido = await this.extrator.extrair(conteudo, anexo.tipoMime, signal);
      const textoKey = await this.objectStorage.armazenar(
        `editais/${input.editalId}/anexos/${anexo.sequencialDocumento}.txt`,
        new TextEncoder().encode(extraido.texto),
        { contentType: 'text/plain; charset=utf-8' },
        signal,
      );
      await this.anexoRepo.atualizarTexto(
        input.editalId,
        anexo.sequencialDocumento,
        textoKey,
        extraido.paginas,
        signal,
      );
    }

    await this.anexoRepo.atualizarEstado(
      input.editalId,
      input.sequencialDocumento,
      resultado,
      signal,
    );

    if (resultado === 'limpo') {
      await this.eventPublisher.publicar(
        new AnexoAprovado({
          editalId: input.editalId,
          sequencialDocumento: anexo.sequencialDocumento,
          nomeAnexo: anexo.nome,
        }),
        signal,
      );
    } else {
      await this.eventPublisher.publicar(
        new AnexoRejeitado({
          editalId: input.editalId,
          sequencialDocumento: anexo.sequencialDocumento,
          nomeAnexo: anexo.nome,
        }),
        signal,
      );
    }
  }
}
