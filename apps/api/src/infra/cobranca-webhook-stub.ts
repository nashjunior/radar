/**
 * Stubs em memória do webhook de pagamento — substituir por
 * `PostgresWebhookEventoRepository`/SQS real (`@radar/cobranca/infra`) quando a infra
 * de Cobrança for provisionada (mesma filosofia de `cobranca-stub.ts`/`matching-stub.ts`).
 *
 * `ConsoleAuditoriaWebhookPagamentoPort` grava no log estruturado (`console`, já
 * redigido/roteado ao CloudWatch por `criarLoggerHttpSeguro`) em vez de um no-op
 * silencioso: docs/05 §4 marca a trilha de auditoria persistente como gap conhecido
 * do MVP-Now, mas "evento recebido → decisão tomada" de um webhook que move dinheiro
 * e acesso (P-107 (5)) precisa deixar rastro verificável mesmo antes do Postgres —
 * nunca lança (fail-open no stub), então nunca bloqueia dev/demo.
 *
 * `InMemoriaFilaDeWebhookPagamento` é o stand-in de SQS (P-27, não provisionado):
 * despacha via `queueMicrotask` para um `WORKER` injetado, com um `AbortController`
 * PRÓPRIO (nunca o `signal` do request HTTP original) — a rota já respondeu ao Asaas
 * antes deste despacho rodar, preservando a compensação "processamento assíncrono"
 * (RAD-253) mesmo sem fila real.
 */

import type { AuditoriaWebhookPagamentoPort, EventoPagamentoAuditoria, FilaDeProcessamentoDeWebhook, ComandoPagamento, WebhookEventoRepository } from '@radar/cobranca';
import { redigirParaLog } from '../logging.js';

export class InMemoriaWebhookEventoRepository implements WebhookEventoRepository {
  private readonly vistos = new Set<string>();

  async registrarSePrimeiraVez(provedor: string, eventoExternoId: string, _signal: AbortSignal): Promise<boolean> {
    const chave = `${provedor}:${eventoExternoId}`;
    if (this.vistos.has(chave)) return false;
    this.vistos.add(chave);
    return true;
  }

  async desfazerRegistro(provedor: string, eventoExternoId: string, _signal: AbortSignal): Promise<void> {
    this.vistos.delete(`${provedor}:${eventoExternoId}`);
  }
}

export class ConsoleAuditoriaWebhookPagamentoPort implements AuditoriaWebhookPagamentoPort {
  async registrar(entrada: EventoPagamentoAuditoria, _signal: AbortSignal): Promise<void> {
    console.log('[Cobrança][audit] webhook de pagamento:', redigirParaLog(entrada));
  }
}

export interface WorkerDeWebhook {
  processar(comando: ComandoPagamento, signal: AbortSignal): Promise<void>;
}

export class InMemoriaFilaDeWebhookPagamento implements FilaDeProcessamentoDeWebhook {
  constructor(private readonly worker: WorkerDeWebhook) {}

  async enfileirar(comando: ComandoPagamento, _signal: AbortSignal): Promise<void> {
    queueMicrotask(() => {
      // Signal independente do request HTTP — a resposta 202 já foi enviada.
      const processamento = new AbortController().signal;
      this.worker.processar(comando, processamento).catch((err) => {
        console.error('[Cobrança][webhook] falha ao processar de forma assíncrona:', redigirParaLog(err));
      });
    });
  }
}

export const webhookEventoStub: WebhookEventoRepository = new InMemoriaWebhookEventoRepository();
export const auditoriaWebhookStub: AuditoriaWebhookPagamentoPort = new ConsoleAuditoriaWebhookPagamentoPort();
