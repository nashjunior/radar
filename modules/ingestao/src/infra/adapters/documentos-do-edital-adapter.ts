import type { EditalId } from '@radar/kernel';
import type { AnexosDTO } from '../../application/dtos.js';
import type { AnexoEditalRepository, DocumentosDoEditalPort } from '../../application/ports.js';
import type { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';

/**
 * Implementação do Open-Host Service de documentos (docs/13, §5).
 * Idempotente: se os refs já estão no repositório de anexos, retorna sem re-baixar.
 * Senão, materializa via BaixarAnexosEditalUseCase e persiste os refs.
 */
export class DocumentosDoEditalAdapter implements DocumentosDoEditalPort {
  constructor(
    private readonly baixarAnexos: BaixarAnexosEditalUseCase,
    private readonly anexos: AnexoEditalRepository,
  ) {}

  async obterDocumentos(editalId: EditalId, signal: AbortSignal): Promise<AnexosDTO> {
    const existentes = await this.anexos.listarPorEdital(editalId, signal);
    if (existentes.length > 0) {
      return { editalId, arquivos: existentes };
    }

    const resultado = await this.baixarAnexos.executar({ editalId }, signal);
    if (resultado.arquivos.length > 0) {
      await this.anexos.salvar(editalId, resultado.arquivos, signal);
    }
    return resultado;
  }
}
