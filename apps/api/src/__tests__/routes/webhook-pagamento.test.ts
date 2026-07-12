/**
 * Testes unitários: POST /webhooks/pagamento (RAD-250)
 *
 * DoD: token inválido ⇒ 401 sem parse; corpo traduzido e ENFILEIRADO (nunca
 * processado dentro do request — compensação "processamento assíncrono" do aceite
 * RAD-253); dedupe/anti-IDOR/confirmação outbound ficam a cargo do
 * `ProcessarEventoDePagamentoUseCase`/`WebhookPagamentoWorker`, cobertos isoladamente
 * em `processar-evento-de-pagamento.test.ts` e `webhook-pagamento-worker.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { FilaDeProcessamentoDeWebhook } from '@radar/cobranca';
import { criarWebhookPagamentoRouter } from '../../routes/webhooks/pagamento.js';

const TOKEN = 'segredo-webhook-de-teste';

function buildApp(opts?: { enfileirar?: ReturnType<typeof vi.fn>; tokensEsperados?: readonly string[] }) {
  const fila = {
    enfileirar: opts?.enfileirar ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as FilaDeProcessamentoDeWebhook;

  const app = new Hono();
  app.route(
    '/webhooks/pagamento',
    criarWebhookPagamentoRouter({ fila, tokensEsperados: opts?.tokensEsperados ?? [TOKEN] }),
  );
  return { app, fila };
}

function payloadPagamentoConfirmado() {
  return {
    id: 'evt-1',
    event: 'PAYMENT_CONFIRMED',
    payment: { id: 'pay-1', subscription: 'sub-ext-1', status: 'CONFIRMED' },
  };
}

describe('POST /webhooks/pagamento — autenticação fail-closed', () => {
  it('token ausente ⇒ 401, nunca enfileira (sem parse do corpo)', async () => {
    const enfileirar = vi.fn();
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(401);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('token errado ⇒ 401, mesmo com corpo malformado (nunca chega a dar parse)', async () => {
    const enfileirar = vi.fn();
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: '{ isto não é json válido',
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'token-errado' },
    });

    expect(res.status).toBe(401);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('token correto + corpo malformado ⇒ 400 (só depois de autenticar)', async () => {
    const { app } = buildApp();

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: '{ não é json',
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /webhooks/pagamento — dupla-chave na janela de rotação (RAD-261)', () => {
  const TOKEN_ANTERIOR = 'segredo-webhook-de-teste-anterior';

  it('token anterior aceito durante a janela de rotação (não derruba notificações em voo)', async () => {
    const { app } = buildApp({ tokensEsperados: [TOKEN, TOKEN_ANTERIOR] });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN_ANTERIOR },
    });

    expect(res.status).toBe(202);
  });

  it('token vigente continua aceito com a janela de rotação ativa', async () => {
    const { app } = buildApp({ tokensEsperados: [TOKEN, TOKEN_ANTERIOR] });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(202);
  });
});

describe('POST /webhooks/pagamento — tradução e enfileiramento (nunca processa inline)', () => {
  it('token correto + evento reconhecido ⇒ 202 e SÓ enfileira, com o comando traduzido', async () => {
    const enfileirar = vi.fn().mockResolvedValue(undefined);
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(202);
    expect(enfileirar).toHaveBeenCalledOnce();
    const [comando, signal] = enfileirar.mock.calls[0]!;
    expect(comando).toEqual({ tipo: 'PagamentoConfirmado', eventoExternoId: 'evt-1', assinaturaExternaId: 'sub-ext-1' });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('token correto + evento fora do catálogo ⇒ 202 no-op, nunca enfileira', async () => {
    const enfileirar = vi.fn();
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify({ id: 'evt-9', event: 'PAYMENT_CREATED', payment: { subscription: 'sub-9' } }),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(202);
    expect(enfileirar).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/pagamento — dedupe/anti-IDOR/confirmação outbound ficam fora da rota', () => {
  it('rota nunca chama o gateway de pagamento nem o use case diretamente — só a fila', async () => {
    // Dedupe, anti-IDOR e confirmação outbound são do ProcessarEventoDePagamentoUseCase,
    // rodando no WebhookPagamentoWorker — a rota não tem acesso a nenhum dos dois,
    // só ao FilaDeProcessamentoDeWebhook (garantido pelo próprio tipo do container).
    const enfileirar = vi.fn().mockResolvedValue(undefined);
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(202);
  });

  it('falha ao ENFILEIRAR (fila indisponível) ⇒ mapeado pela borda, nunca 202', async () => {
    const { AuditoriaIndisponivelError } = await import('@radar/kernel');
    const enfileirar = vi.fn().mockRejectedValue(new AuditoriaIndisponivelError());
    const { app } = buildApp({ enfileirar });

    const res = await app.request('/webhooks/pagamento', {
      method: 'POST',
      body: JSON.stringify(payloadPagamentoConfirmado()),
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    });

    expect(res.status).toBe(503);
  });
});
