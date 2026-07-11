import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { ReconciliacaoDTO } from '../dtos.js';
import { paraEventoEditalIngerido } from '../mappers.js';
import { NormalizarEPersistirEditalService } from '../services/normalizar-e-persistir-edital-service.js';
import type {
  EditalRepository,
  EventPublisher,
  PncpGateway,
  ProvenienciaRepository,
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
 *
 * Correção RAD-184: o reingest agora registra proveniência (docs/05 §5 — "cada registro
 * sabe de onde veio, quando e sob qual base legal") via `NormalizarEPersistirEditalService`,
 * igual aos outros 2 fluxos de ingestão. Antes desta correção, a reconciliação fazia upsert
 * sem gravar proveniência — gap identificado no sweep de duplicação (RAD-183/RAD-184).
 *
 * Correção RAD-188/189: `signal.aborted` interrompe o lote — nunca contado em `erros`.
 */
export class ReconciliarCatalogoUseCase {
  private readonly normalizarEPersistir: NormalizarEPersistirEditalService;

  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    proveniencias: ProvenienciaRepository,
    private readonly eventos: EventPublisher,
  ) {
    this.normalizarEPersistir = new NormalizarEPersistirEditalService(editais, proveniencias);
  }

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
            {
              cnpj: editalLocal.orgao.cnpj.valor,
              anoCompra: editalLocal.anoCompra,
              sequencialCompra: editalLocal.sequencialCompra,
            },
            signal,
          );

          if (dadoAtual === null) continue;

          const divergiu =
            dadoAtual.faseAtual !== editalLocal.faseAtual ||
            dadoAtual.dataAtualizacao.getTime() !== editalLocal.dataAtualizacao.getTime();

          if (!divergiu) continue;

          const editalAtualizado = await this.normalizarEPersistir.persistir(
            editalLocal.id,
            dadoAtual,
            signal,
          );

          await this.eventos.publicar(paraEventoEditalIngerido(editalAtualizado), signal);

          reingeridos++;
        } catch (err) {
          if (signal.aborted) throw err;
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
