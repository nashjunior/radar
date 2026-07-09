import { Edital } from '../../domain/entities/edital.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { IngestaoResumoDTO } from '../dtos.js';
import { EditalIngerido } from '../events.js';
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
 */
export class IngerirEditaisUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly proveniencias: ProvenienciaRepository,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
  ) {}

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

          const edital = Edital.criar({
            id,
            ...dado,
            proveniencia: {
              fonte: 'PNCP',
              baseLegal: 'Lei 14.133/2021, art. 174',
              coletadoEm: new Date(),
            },
          });

          await this.editais.upsertPorNumeroControle(edital, signal);

          await this.proveniencias.registrar(
            {
              editalId: edital.id,
              fonte: 'PNCP',
              baseLegal: 'Lei 14.133/2021, art. 174',
              coletadoEm: edital.proveniencia.coletadoEm,
            },
            signal,
          );

          await this.eventos.publicar(
            new EditalIngerido({
              editalId: edital.id,
              numeroControlePncp: edital.numeroControlePncp.valor,
              modalidadeCodigo: edital.modalidade.codigo,
              faseAtual: edital.faseAtual,
              dataAtualizacao: edital.dataAtualizacao,
              objeto: edital.objeto,
              orgaoUf: edital.orgao.uf,
              valorEstimado: edital.valorEstimado?.valor ?? null,
              dataPublicacao: edital.dataPublicacao,
              proveniencia: {
                fonte: edital.proveniencia.fonte,
                baseLegal: edital.proveniencia.baseLegal,
                dataColeta: edital.proveniencia.coletadoEm.toISOString(),
              },
            }),
            signal,
          );

          existente !== null ? atualizados++ : ingeridos++;
        } catch (err) {
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
