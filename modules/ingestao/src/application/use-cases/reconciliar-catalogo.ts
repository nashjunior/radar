import { Edital } from '../../domain/entities/edital.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { ReconciliacaoDTO } from '../dtos.js';
import { EditalIngerido } from '../events.js';
import type {
  EditalRepository,
  EventPublisher,
  PncpGateway,
} from '../ports.js';

export interface ReconciliarCatalogoInput {
  janela: { inicio: Date; fim: Date };
}

/**
 * Varredura periódica ampla para garantir cobertura ≥ 99% (docs/12, NFR).
 * Trigger: Scheduler diário (A02, §3 — regime 3).
 *
 * Para cada edital local na janela, compara com o PNCP e reingeere se divergir.
 * Divergência entre reconciliação e incremental é sinal de anomalia.
 */
export class ReconciliarCatalogoUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(
    input: ReconciliarCatalogoInput,
    signal: AbortSignal,
  ): Promise<ReconciliacaoDTO> {
    let verificados = 0;
    let reingeridos = 0;
    let erros = 0;

    const paginas = this.editais.listarPorJanelaPublicacao(input.janela, signal);

    for await (const pagina of paginas) {
      for (const editalLocal of pagina) {
        try {
          verificados++;

          const dadoAtual = await this.pncpGateway.buscarContratacaoPorNumero(
            editalLocal.numeroControlePncp.valor,
            signal,
          );

          if (dadoAtual === null) continue;

          const divergiu =
            dadoAtual.faseAtual !== editalLocal.faseAtual ||
            dadoAtual.dataAtualizacao.getTime() !== editalLocal.dataAtualizacao.getTime();

          if (!divergiu) continue;

          const editalAtualizado = Edital.criar({
            id: editalLocal.id,
            ...dadoAtual,
            proveniencia: {
              fonte: 'PNCP',
              baseLegal: 'Lei 14.133/2021, art. 174',
              coletadoEm: new Date(),
            },
          });

          await this.editais.upsertPorNumeroControle(editalAtualizado, signal);

          await this.eventos.publicar(
            new EditalIngerido({
              editalId: editalAtualizado.id,
              numeroControlePncp: editalAtualizado.numeroControlePncp.valor,
              modalidadeCodigo: editalAtualizado.modalidade.codigo,
              faseAtual: editalAtualizado.faseAtual,
              dataAtualizacao: editalAtualizado.dataAtualizacao,
            }),
            signal,
          );

          reingeridos++;
        } catch (err) {
          if (err instanceof FonteIndisponivelError || err instanceof SchemaDriftError) {
            throw err;
          }
          erros++;
        }
      }
    }

    return {
      janela: {
        inicio: input.janela.inicio.toISOString(),
        fim: input.janela.fim.toISOString(),
      },
      verificados,
      reingeridos,
      erros,
    };
  }
}
