import type { EditalId } from '@radar/kernel';
import { OcrFalhouError } from '../../domain/errors/index.js';
import { Triagem } from '../../domain/triagem.js';
import { TriagemFalhou, TriagemSolicitada } from '../events.js';
import type { DocumentosEditalGateway, EventPublisher, TriagemRepository } from '../ports.js';

/** `code` estável de `OcrFalhouError` (fonte única — nunca duplicar o literal). */
const MOTIVO_OCR_FALHOU = new OcrFalhouError().code;

export interface ReenfileirarTriagensPendentesInput {
  editalId: EditalId;
  /** Outro anexo do MESMO edital ainda sem resultado de scan (payload de `anexo.aprovado`/`anexo.rejeitado`, P-104/AB14). */
  restamAnexosPendentes: boolean;
}

/**
 * Fecha o loop de disponibilidade do anexo (P-110/RAD-281): consumidor de `anexo.aprovado` e
 * `anexo.rejeitado` (Ingestão, Published Language, A03 §3). O fail-closed de
 * `DocumentosDoEditalAdapter` está certo (P-104/AB14 — anexo `pendente` não sai para o consumidor),
 * mas faltava o outro lado: ninguém re-tentava a triagem quando o scan aprovava.
 *
 * Para cada triagem `processando` do edital:
 *   - documento principal já disponível (ACL devolve `arquivos` não-vazio) → reenfileira
 *     `triagem.solicitada` (o worker de Triagem tenta de novo, RAD-259).
 *   - nenhum documento disponível E não resta mais anexo pendente de scan (`restamAnexosPendentes:
 *     false`) → o anexo NUNCA vai ficar disponível (todos rejeitados/formato não suportado) — falha
 *     terminal explícita (`falha_ocr` + `triagem.falhou`, RAD-255/P-107 (c): libera a reserva de cota).
 *   - ainda resta anexo pendente → no-op; aguarda o próximo evento de scan.
 */
export class ReenfileirarTriagensPendentesUseCase {
  constructor(
    private readonly triagens: TriagemRepository,
    private readonly documentosGateway: DocumentosEditalGateway,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: ReenfileirarTriagensPendentesInput, signal: AbortSignal): Promise<void> {
    const pendentes = await this.triagens.listarProcessandoPorEdital(input.editalId, signal);
    if (pendentes.length === 0) return; // ninguém esperando este edital

    const docs = await this.documentosGateway.obterRefs(input.editalId, signal);

    if (docs.arquivos.length > 0) {
      for (const triagem of pendentes) {
        await this.eventos.publicar(
          new TriagemSolicitada({
            tenantId: triagem.tenantId,
            usuarioId: triagem.clienteFinalId,
            editalId: input.editalId,
            perfilId: triagem.perfilId,
            // RAD-271: a `Triagem` não persiste o coorte trial da solicitação original — default
            // seguro (nunca bloqueia o pagante); pior caso é o bulkhead do coorte trial não se
            // aplicar a este reenfileiramento específico.
            coorteTrial: false,
          }),
          signal,
        );
      }
      return;
    }

    if (input.restamAnexosPendentes) return; // ainda pode chegar — aguarda o próximo evento

    // Todos os anexos do edital já resolveram e nenhum ficou `limpo`: nunca vai ficar disponível.
    for (const triagem of pendentes) {
      await this.triagens.salvar(
        Triagem.falhaOcr(input.editalId, triagem.perfilId, triagem.tenantId, triagem.clienteFinalId),
        signal,
      );
      await this.eventos.publicar(
        new TriagemFalhou({
          tenantId: triagem.tenantId,
          clienteFinalId: triagem.clienteFinalId,
          editalId: input.editalId,
          perfilId: triagem.perfilId,
          motivo: MOTIVO_OCR_FALHOU,
        }),
        signal,
      );
    }
  }
}
