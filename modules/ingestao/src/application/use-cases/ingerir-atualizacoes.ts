import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { IngestaoResumoDTO } from '../dtos.js';
import { paraEventoEditalIngerido, paraEventoFaseMudou } from '../mappers.js';
import { NormalizarEPersistirEditalService } from '../services/normalizar-e-persistir-edital-service.js';
import type {
  EditalRepository,
  EventPublisher,
  IdProvider,
  PncpGateway,
  ProvenienciaRepository,
} from '../ports.js';

export interface IngerirAtualizacoesInput {
  janela: { inicio: Date; fim: Date };
}

/**
 * Coleta contratações atualizadas no PNCP via endpoint `/atualizacao` e persiste.
 * Trigger: Scheduler incremental do regime 2 de atualizações (A02, §3).
 *
 * Invariantes:
 *   - Upsert idempotente por `numeroControlePNCP` → retry seguro.
 *   - Publica `edital.fase-mudou` quando a fase muda em relação ao registro local.
 *   - Publica `edital.ingerido` para editais ainda não conhecidos.
 *   - `SchemaDriftError` e `FonteIndisponivelError` são fatais: interrompem o lote.
 *   - Abort (RAD-188/189): `signal.aborted` também interrompe o lote — nunca contado em `erros`.
 *
 * Cadência (P-29): este use case é acionado a cada 5 min com janela de 35 min
 * para atingir frescor p95 ≤ 30 min sem furar rate-limit (ver PncpPollingScheduler).
 */
export class IngerirAtualizacoesUseCase {
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
    input: IngerirAtualizacoesInput,
    signal: AbortSignal,
  ): Promise<IngestaoResumoDTO> {
    let ingeridos = 0;
    let atualizados = 0;
    let erros = 0;

    const paginas = this.pncpGateway.buscarContratacoesPorAtualizacao(input.janela, signal);

    for await (const pagina of paginas) {
      for (const dado of pagina) {
        try {
          const existente = await this.editais.porNumeroControle(
            dado.numeroControlePncp,
            signal,
          );

          const id = existente?.id ?? this.ids.gerar();

          const edital = await this.normalizarEPersistir.persistir(id, dado, signal);

          if (existente !== null && dado.faseAtual !== existente.faseAtual) {
            await this.eventos.publicar(paraEventoFaseMudou(existente, edital), signal);
            atualizados++;
          } else if (existente !== null) {
            atualizados++;
          } else {
            await this.eventos.publicar(paraEventoEditalIngerido(edital), signal);
            ingeridos++;
          }
        } catch (err) {
          if (signal.aborted) throw err;
          if (err instanceof FonteIndisponivelError || err instanceof SchemaDriftError) {
            throw err;
          }
          erros++;
        }
      }
    }

    // modalidade=0 indica regime de atualizacao (sem filtro por modalidade)
    return {
      modalidade: 0,
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
