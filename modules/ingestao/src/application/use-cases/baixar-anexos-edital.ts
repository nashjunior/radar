import type { EditalId } from '@radar/kernel';
import {
  AnexoIndisponivelError,
  EditalNaoEncontradoError,
  ESTADO_INICIAL_ANEXO,
} from '../../domain/index.js';
import { AnexoQuarentenado } from '../events.js';
import type {
  AnexoEditalRepository,
  EditalRepository,
  EventPublisher,
  ObjectStorage,
  PncpGateway,
} from '../ports.js';

export interface BaixarAnexosEditalInput {
  editalId: EditalId;
}

/**
 * Baixa os arquivos/anexos de um edital sob demanda e os coloca em quarentena.
 * Trigger: antes da triagem (A02, §6).
 *
 * Trust-gating (P-104, AB14): cada anexo é salvo com estado `pendente` e
 * um evento `AnexoQuarentenado` é publicado para o worker de scan assíncrono.
 * Triagem/front/download só recebem objetos aprovados como `limpo`.
 */
export class BaixarAnexosEditalUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly objectStorage: ObjectStorage,
    private readonly anexoRepo: AnexoEditalRepository,
    private readonly eventPublisher: EventPublisher,
  ) {}

  async executar(
    input: BaixarAnexosEditalInput,
    signal: AbortSignal,
  ): Promise<void> {
    const edital = await this.editais.porId(input.editalId, signal);
    if (edital === null) {
      throw new EditalNaoEncontradoError(input.editalId);
    }

    const arquivos = await this.pncpGateway.buscarArquivos(
      {
        cnpj: edital.orgao.cnpj.valor,
        anoCompra: edital.anoCompra,
        sequencialCompra: edital.sequencialCompra,
      },
      signal,
    );

    for (const arquivo of arquivos) {
      try {
        const conteudo = await this.pncpGateway.downloadArquivo(
          arquivo.urlOrigem,
          signal,
        );

        const chave = `editais/${edital.id}/anexos/${arquivo.nome}`;

        const storageKey = await this.objectStorage.armazenar(
          chave,
          conteudo,
          { contentType: arquivo.tipoMime },
          signal,
        );

        await this.anexoRepo.salvar(
          input.editalId,
          [
            {
              nome: arquivo.nome,
              storageKey,
              tamanhoBytes: arquivo.tamanhoBytes,
              tipoMime: arquivo.tipoMime,
              estadoConfianca: ESTADO_INICIAL_ANEXO,
            },
          ],
          signal,
        );

        await this.eventPublisher.publicar(
          new AnexoQuarentenado({
            editalId: input.editalId,
            nomeAnexo: arquivo.nome,
            storageKey,
          }),
          signal,
        );
      } catch (err) {
        if (err instanceof AnexoIndisponivelError) throw err;
        throw new AnexoIndisponivelError(arquivo.nome);
      }
    }
  }
}
