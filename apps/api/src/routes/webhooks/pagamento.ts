/**
 * Rota: POST /webhooks/pagamento
 *
 * ACL do webhook do gateway de pagamento (P-107 (5), RAD-250) — servidor-a-servidor,
 * deliberadamente FORA de `/api/*`: não passa por sessão de usuário, então não leva
 * `autenticarMiddleware` (Cognito) nem `csrfMiddleware` (esses dois só cobrem o
 * prefixo `/api/*`, montado em `security.ts`/`server.ts`). Autenticação própria,
 * fail-closed:
 *
 *   1. Valida `asaas-access-token` (comparação em tempo constante) ANTES de ler ou
 *      fazer parse do corpo — o Asaas autentica por token estático + allowlist de IP
 *      na borda (WAF, fora do escopo desta rota), não por HMAC no raw body (aceite
 *      RAD-239/RAD-253). Token inválido/ausente ⇒ 401 sem tocar no corpo.
 *   2. Corpo é traduzido para o vocabulário PRÓPRIO (`traduzirEventoAsaas`) — o tipo
 *      do provedor morre no adapter; evento fora do catálogo é no-op (202), nunca erro.
 *   3. A rota só ENFILEIRA o comando (`FilaDeProcessamentoDeWebhook`) — nunca chama o
 *      gateway de confirmação nem muta o agregado neste request. Isso é a compensação
 *      "processamento assíncrono" exigida pelo aceite de segurança (RAD-253) por não
 *      haver HMAC no raw body do Asaas: o `ProcessarEventoDePagamentoUseCase` (dedupe,
 *      confirmação outbound, mutação, auditoria) roda desacoplado, no
 *      `WebhookPagamentoWorker`.
 *
 * Refs: docs/98 P-107 (5), RAD-239, RAD-253, docs/05 §4.
 */

import { Hono } from 'hono';
import type { FilaDeProcessamentoDeWebhook } from '@radar/cobranca';
import { traduzirEventoAsaas, tokenWebhookAsaasValido } from '@radar/cobranca/infra';
import { responderErro } from '../../errors.js';

export interface WebhookPagamentoContainer {
  fila: FilaDeProcessamentoDeWebhook;
  /**
   * Segredos válidos (vigente + anterior, RAD-261 — janela de rotação do Secrets
   * Manager, P-08). Lista vazia ou só com strings vazias ⇒ rota sempre recusa
   * (fail-closed por padrão).
   */
  tokensEsperados: readonly string[];
}

export function criarWebhookPagamentoRouter(container: WebhookPagamentoContainer): Hono {
  const router = new Hono();

  router.post('/', async (c) => {
    const tokenRecebido = c.req.header('asaas-access-token');
    if (!tokenWebhookAsaasValido(tokenRecebido, container.tokensEsperados)) {
      // Fail-closed: nada de c.req.json()/c.req.text() antes desta checagem.
      return c.json({ code: 'NAO_AUTENTICADO', mensagem: 'Token inválido.' }, 401);
    }

    const signal = c.req.raw.signal;

    let corpo: unknown;
    try {
      corpo = await c.req.json();
    } catch {
      return c.json({ code: 'CORPO_INVALIDO', mensagem: 'Corpo inválido.' }, 400);
    }

    const comando = traduzirEventoAsaas(corpo);
    if (!comando) return c.json({ ok: true }, 202); // evento fora do nosso catálogo — no-op, não é erro

    try {
      await container.fila.enfileirar(comando, signal);
    } catch (err) {
      // Falha ao ENFILEIRAR (nada foi processado ainda) — seguro deixar o provedor reentregar.
      return responderErro(c, err);
    }

    return c.json({ ok: true }, 202); // Accepted: processamento real acontece assíncrono (RAD-253)
  });

  return router;
}
