import type { ComandoPagamento } from '../../application/dtos.js';
import type { ProcessarEventoDePagamentoUseCase } from '../../application/use-cases/processar-evento-de-pagamento.js';

/**
 * Consumidor assíncrono do webhook do gateway de pagamento (RAD-250) — é a
 * compensação "processamento assíncrono" exigida pelo aceite de segurança RAD-253
 * (P-107 (5)): desacopla dedupe, confirmação outbound ao gateway, mutação do
 * agregado e auditoria do ciclo de request/response HTTP do provedor. A rota só
 * enfileira via `FilaDeProcessamentoDeWebhook`; este worker é quem de fato chama
 * `ProcessarEventoDePagamentoUseCase`.
 *
 * Sem DLQ própria: `ProcessarEventoDePagamentoUseCase` já resolve toda transição de
 * negócio inválida como no-op auditado internamente (nunca lança `DomainError` de
 * fluxo esperado) e desfaz o próprio dedupe em erro de infraestrutura — um erro que
 * chega até aqui é sempre infra (auditoria/DB indisponível) e deve relançar para a
 * fila reentregar, mesmo padrão de `CobrancaWorker.processarTriagemFalhou`.
 */
export class WebhookPagamentoWorker {
  constructor(private readonly processarEventoDePagamentoUC: ProcessarEventoDePagamentoUseCase) {}

  async processar(comando: ComandoPagamento, signal: AbortSignal): Promise<void> {
    await this.processarEventoDePagamentoUC.executar(comando, signal);
  }
}
