import type { EditalId } from '@radar/kernel';
import {
  AnexoIndisponivelError,
  EditalNaoEncontradoError,
} from '../../domain/errors/index.js';
import type { AnexosDTO } from '../dtos.js';
import type {
  EditalRepository,
  ObjectStorage,
  PncpGateway,
} from '../ports.js';

export interface BaixarAnexosEditalInput {
  editalId: EditalId;
}

/**
 * Baixa os arquivos/anexos de um edital sob demanda e os armazena.
 * Trigger: antes da triagem (A02, §6).
 *
 * PDFs são persistidos no object storage com referência à chave de acesso.
 * Retenção dos anexos segue a política definida em docs/05, §5. [A VALIDAR — prazo]
 */
export class BaixarAnexosEditalUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly objectStorage: ObjectStorage,
  ) {}

  async executar(
    input: BaixarAnexosEditalInput,
    signal: AbortSignal,
  ): Promise<AnexosDTO> {
    const edital = await this.editais.porId(input.editalId, signal);
    if (edital === null) {
      throw new EditalNaoEncontradoError(input.editalId);
    }

    const arquivos = await this.pncpGateway.buscarArquivos(
      edital.numeroControlePncp.valor,
      signal,
    );

    const downloadados = [];

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

        downloadados.push({
          nome: arquivo.nome,
          storageKey,
          tamanhoBytes: arquivo.tamanhoBytes,
          tipoMime: arquivo.tipoMime,
        });
      } catch (err) {
        if (err instanceof AnexoIndisponivelError) throw err;
        throw new AnexoIndisponivelError(arquivo.nome);
      }
    }

    return { editalId: input.editalId, arquivos: downloadados };
  }
}
