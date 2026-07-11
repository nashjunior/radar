import {
  EditalNaoEncontradoError,
  FonteIndisponivelError,
} from '../../domain/errors/index.js';
import type { EditalDTO } from '../dtos.js';
import { EditalFaseMudou } from '../events.js';
import { editalParaDTO } from '../mappers.js';
import type {
  EditalRepository,
  EventPublisher,
  PncpGateway,
} from '../ports.js';

export interface AtualizarFaseEditalInput {
  numeroControlePncp: string;
}

/**
 * Atualiza a fase de um edital consultando o estado atual no PNCP.
 * Trigger: Scheduler do endpoint `/atualizacao` (A02, §3 — regime 2).
 *
 * Publica `edital.fase-mudou` apenas quando a fase realmente muda.
 */
export class AtualizarFaseEditalUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(
    input: AtualizarFaseEditalInput,
    signal: AbortSignal,
  ): Promise<EditalDTO> {
    const editalAtual = await this.editais.porNumeroControle(
      input.numeroControlePncp,
      signal,
    );
    if (editalAtual === null) {
      throw new EditalNaoEncontradoError(input.numeroControlePncp);
    }

    const dadoNovo = await this.pncpGateway.buscarContratacaoPorNumero(
      input.numeroControlePncp,
      signal,
    );
    if (dadoNovo === null) {
      throw new FonteIndisponivelError('PNCP');
    }

    if (dadoNovo.faseAtual === editalAtual.faseAtual) {
      return editalParaDTO(editalAtual);
    }

    const editalAtualizado = editalAtual.atualizarFase(
      dadoNovo.faseAtual,
      dadoNovo.dataAtualizacao,
    );

    await this.editais.upsertPorNumeroControle(editalAtualizado, signal);

    await this.eventos.publicar(
      new EditalFaseMudou({
        editalId: editalAtualizado.id,
        numeroControlePncp: editalAtualizado.numeroControlePncp.valor,
        faseAnterior: editalAtual.faseAtual,
        faseAtual: editalAtualizado.faseAtual,
        dataAtualizacao: editalAtualizado.dataAtualizacao,
      }),
      signal,
    );

    return editalParaDTO(editalAtualizado);
  }
}
