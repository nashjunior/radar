import { EditalId } from '@radar/kernel';
import type { ReenfileirarTriagensPendentesUseCase } from '../../application/use-cases/reenfileirar-triagens-pendentes.js';

/** Contrato canônico de `anexo.aprovado`/`anexo.rejeitado` que a Triagem consome (A03 §3, P-110/RAD-281). */
export interface AnexoResolvidoMsg {
  editalId: string;
  restamPendentes: boolean;
}

/**
 * Consumidor de `anexo.aprovado`/`anexo.rejeitado` (Ingestão) — fecha o loop de disponibilidade do
 * anexo (P-110/RAD-281). Mesmo padrão de `CobrancaWorker` (`modules/cobranca/src/infra/queue`): o
 * contrato do evento é replicado aqui como DTO local — a Triagem nunca importa `modules/ingestao`
 * (isolamento de bounded context, docs/13 §4).
 */
export class AnexoDisponibilidadeWorker {
  constructor(private readonly reenfileirar: ReenfileirarTriagensPendentesUseCase) {}

  async processar(msg: AnexoResolvidoMsg, signal: AbortSignal): Promise<void> {
    await this.reenfileirar.executar(
      { editalId: EditalId(msg.editalId), restamAnexosPendentes: msg.restamPendentes },
      signal,
    );
  }
}
