import type { EditalId } from '@radar/kernel';
import {
  AnexoFormatoNaoSuportadoError,
  AnexoIndisponivelError,
  EditalNaoEncontradoError,
  ESTADO_INICIAL_ANEXO,
  ExtensaoAnexo,
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
        const baixado = await this.pncpGateway.downloadArquivo(
          arquivo.urlOrigem,
          signal,
        );

        // Chave só de dado estrutural nosso — `titulo` é texto livre do órgão
        // (path traversal + sobrescrita silenciosa, RAD-278). `sequencialDocumento`
        // é a chave natural do documento na compra; extensão sai do sniff de
        // magic bytes (nunca do nome que o órgão mandou).
        const extensao = ExtensaoAnexo.criar(baixado.tipoMime);
        const chave = `editais/${edital.id}/anexos/${arquivo.sequencialDocumento}.${extensao}`;

        const storageKey = await this.objectStorage.armazenar(
          chave,
          baixado.conteudo,
          { contentType: baixado.tipoMime },
          signal,
        );

        await this.anexoRepo.salvar(
          input.editalId,
          [
            {
              sequencialDocumento: arquivo.sequencialDocumento,
              nome: arquivo.titulo,
              storageKey,
              tamanhoBytes: baixado.tamanhoBytes,
              tipoMime: baixado.tipoMime,
              estadoConfianca: ESTADO_INICIAL_ANEXO,
            },
          ],
          signal,
        );

        await this.eventPublisher.publicar(
          new AnexoQuarentenado({
            editalId: input.editalId,
            sequencialDocumento: arquivo.sequencialDocumento,
            nomeAnexo: arquivo.titulo,
            storageKey,
          }),
          signal,
        );
      } catch (err) {
        if (err instanceof AnexoIndisponivelError || err instanceof AnexoFormatoNaoSuportadoError) {
          throw err;
        }
        throw new AnexoIndisponivelError(arquivo.titulo);
      }
    }
  }
}
