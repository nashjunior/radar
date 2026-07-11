import { Edital } from '../../domain/entities/edital.js';
import {
  FonteIndisponivelError,
  SchemaDriftError,
} from '../../domain/errors/index.js';
import type { IngestaoResumoDTO } from '../dtos.js';
import { EditalFaseMudou, EditalIngerido } from '../events.js';
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
 *
 * Cadência (P-29): este use case é acionado a cada 5 min com janela de 35 min
 * para atingir frescor p95 ≤ 30 min sem furar rate-limit (ver PncpPollingScheduler).
 */
export class IngerirAtualizacoesUseCase {
  constructor(
    private readonly pncpGateway: PncpGateway,
    private readonly editais: EditalRepository,
    private readonly proveniencias: ProvenienciaRepository,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
  ) {}

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

          if (existente !== null && dado.faseAtual !== existente.faseAtual) {
            await this.eventos.publicar(
              new EditalFaseMudou({
                editalId: edital.id,
                numeroControlePncp: edital.numeroControlePncp.valor,
                faseAnterior: existente.faseAtual,
                faseAtual: edital.faseAtual,
                dataAtualizacao: edital.dataAtualizacao,
              }),
              signal,
            );
            atualizados++;
          } else if (existente !== null) {
            atualizados++;
          } else {
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
            ingeridos++;
          }
        } catch (err) {
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
