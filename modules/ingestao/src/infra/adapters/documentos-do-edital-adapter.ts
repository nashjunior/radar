import type { EditalId } from '@radar/kernel';
import type { AnexosDTO, ArquivoDTO } from '../../application/dtos.js';
import type { AnexoEditalRepository, DocumentosDoEditalPort } from '../../application/ports.js';
import type { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';

/**
 * Implementação do Open-Host Service de documentos (docs/13, §5).
 *
 * Trust-gating (P-104, AB14): só entrega anexos `limpos` ao consumidor.
 * Anexos pendentes ou rejeitados são retidos (fail-closed).
 * Se nenhum arquivo foi baixado ainda, dispara o download → quarentena.
 */
export class DocumentosDoEditalAdapter implements DocumentosDoEditalPort {
  constructor(
    private readonly baixarAnexos: BaixarAnexosEditalUseCase,
    private readonly anexos: AnexoEditalRepository,
  ) {}

  async obterDocumentos(editalId: EditalId, signal: AbortSignal): Promise<AnexosDTO> {
    const todos = await this.anexos.listarPorEdital(editalId, signal);

    const limpos: ArquivoDTO[] = todos
      .filter((a) => a.estadoConfianca === 'limpo')
      .map(({ estadoConfianca: _estado, ...resto }) => resto);

    if (limpos.length > 0) {
      return { editalId, arquivos: limpos };
    }

    if (todos.length === 0) {
      await this.baixarAnexos.executar({ editalId }, signal);
    }

    return { editalId, arquivos: [] };
  }
}
