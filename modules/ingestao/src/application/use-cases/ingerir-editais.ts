import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { IngestaoResumoDTO } from '../dtos.js';
import { paraEventoEditalIngerido } from '../mappers.js';
import { NormalizarEPersistirEditalService } from '../services/normalizar-e-persistir-edital-service.js';
import type {
  EditalRepository,
  EventPublisher,
  IdProvider,
  PncpGateway,
  ProvenienciaRepository,
} from '../ports.js';

export interface IngerirEditaisInput {
  /** Código de modalidade do PNCP (A02, §3). [A VALIDAR — mapear códigos no Swagger] */
  modalidade: number;
  janela: { inicio: Date; fim: Date };
}

/**
 * Coleta contratações do PNCP por modalidade + janela, normaliza e persiste.
 * Trigger: Scheduler de polling incremental (A02, §3 — regime 2).
 *
 * Invariantes:
 *   - Upsert idempotente por `numeroControlePNCP` → retry seguro (A02, §3).
 *   - Minimização aplicada no ACL (PncpGateway) antes de chegar ao use case (A02, §4).
 *   - Proveniência obrigatória em todo edital gravado (docs/05, §5).
 *   - `SchemaDriftError` e `FonteIndisponivelError` são fatais: interrompem o lote.
 *   - Abort (RAD-188/189): `signal.aborted` também interrompe o lote — nunca contado em `erros`.
 */
export class IngerirEditaisUseCase {
  private readonly normalizarEPersistir: NormalizarEPersistirEditalService;

  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    proveniencias: ProvenienciaRepository,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
  ) {
    this.normalizarEPersistir = new NormalizarEPersistirEditalService(editais, proveniencias);
  }

  async executar(
    input: IngerirEditaisInput,
    signal: AbortSignal,
  ): Promise<IngestaoResumoDTO> {
    let ingeridos = 0;
    let atualizados = 0;
    let erros = 0;

    const paginas = this.pncpGateway.buscarContratacoesPorPublicacao(
      input.modalidade,
      input.janela,
      signal,
    );

    for await (const pagina of paginas) {
      for (const dado of pagina) {
        try {
          const existente = await this.editais.porNumeroControle(
            dado.numeroControlePncp,
            signal,
          );

          const id = existente?.id ?? this.ids.gerar();

          const edital = await this.normalizarEPersistir.persistir(id, dado, signal);

          await this.eventos.publicar(paraEventoEditalIngerido(edital), signal);

          existente !== null ? atualizados++ : ingeridos++;
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
      modalidade: input.modalidade,
      janela: {
        inicio: input.janela.inicio.toISOString(),
        fim: input.janela.fim.toISOString(),
      },
      ingeridos,
      atualizados,
      erros,
    };
  }
}
