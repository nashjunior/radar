/**
 * RAD-316 — composition root da Notificação em `apps/api`. Antes desta correção,
 * `iniciarWorkers()` nunca construía `NotificarAlertaUseCase`/`EnviarDigestUseCase`/
 * `NotificacaoWorker` — o assinante evento→EMF (RAD-302) ficava sem consumidor real de
 * `alerta.gerado` para alimentar `notificacao.latencia_entrega_ms` (docs/08 §4.1).
 *
 * RAD-319 — gate `QUEUE_TRANSPORT=stub|sqs` (item 1) e o item 6 ("sem URL, não sobe, não
 * falha o boot"): os testes abaixo não tocam rede — sem `<NOME>_QUEUE_URL` configurada,
 * `iniciarConsumidor`/`iniciarMatching` nunca chegam a chamar `SQSClient.send`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { iniciarWorkers } from '../workers.js';

const ENV_KEYS_RAD319 = [
  'QUEUE_TRANSPORT',
  'DATABASE_URL',
  'TRIAGEM_SOLICITADA_QUEUE_URL',
  'TRIAGEM_CONCLUIDA_QUEUE_URL',
  'TRIAGEM_FALHOU_QUEUE_URL',
  'ORGANIZACAO_PROVISIONADA_QUEUE_URL',
  'ANEXO_RESOLVIDO_QUEUE_URL',
  'ALERTAS_GERADOS_QUEUE_URL',
  'ALERTAS_A_GRAVAR_QUEUE_URL',
  'EDITAIS_INGERIDOS_QUEUE_URL',
];

afterEach(() => {
  delete process.env['WORKERS_ENABLED'];
  delete process.env['ANTHROPIC_API_KEY'];
  for (const key of ENV_KEYS_RAD319) delete process.env[key];
});

describe('iniciarWorkers', () => {
  it('retorna null quando WORKERS_ENABLED não é "true"', () => {
    expect(iniciarWorkers()).toBeNull();
  });

  it('constrói notificacaoWorker/enviarDigestUseCase mesmo sem ANTHROPIC_API_KEY (Notificação não depende de LLM)', () => {
    process.env['WORKERS_ENABLED'] = 'true';

    const handle = iniciarWorkers();

    expect(handle).not.toBeNull();
    expect(handle?.notificacaoWorker).toBeDefined();
    expect(handle?.enviarDigestUseCase).toBeDefined();
    expect(handle?.worker).toBeNull(); // gate de LLM continua isolado ao worker de Triagem
  });

  it('notificacaoWorker.processar consome uma mensagem de alerta.gerado sem lançar (stub de ClienteFinalGateway ainda sem ACL)', async () => {
    process.env['WORKERS_ENABLED'] = 'true';

    const handle = iniciarWorkers();
    const signal = new AbortController().signal;

    await expect(
      handle!.notificacaoWorker.processar(
        {
          alertaId: 'alerta-316',
          tenantId: 'tenant-316',
          clienteFinalId: 'cliente-316',
          alertaGeradoEm: new Date().toISOString(),
          imediato: true,
        },
        signal,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('RAD-319 — gate QUEUE_TRANSPORT', () => {
  it('default (QUEUE_TRANSPORT ausente) é "stub" — matchingComposicao null, teardown não lança', () => {
    process.env['WORKERS_ENABLED'] = 'true';

    const handle = iniciarWorkers();

    expect(handle).not.toBeNull();
    expect(handle?.matchingComposicao).toBeNull();
    expect(() => handle?.teardown()).not.toThrow();
  });

  it('QUEUE_TRANSPORT=sqs sem nenhuma *_QUEUE_URL não falha o boot (item 6) — consumidores/publishers caem no fallback no-op', () => {
    process.env['WORKERS_ENABLED'] = 'true';
    process.env['QUEUE_TRANSPORT'] = 'sqs';

    // Se qualquer gate faltante lançasse em vez de logar, esta chamada already teria derrubado o
    // teste (exceção não capturada) — não precisa de `expect().not.toThrow()`.
    const handle = iniciarWorkers();

    expect(handle).not.toBeNull();
    // Sem DATABASE_URL — Matching não entra (RAD-317: sem variante stub).
    expect(handle?.matchingComposicao).toBeNull();
    expect(() => handle?.teardown()).not.toThrow();
  });

  it('QUEUE_TRANSPORT=sqs com ANEXO_RESOLVIDO_QUEUE_URL ausente: anexoDisponibilidadeWorker ainda é construído (consumidor só não sobe)', () => {
    process.env['WORKERS_ENABLED'] = 'true';
    process.env['QUEUE_TRANSPORT'] = 'sqs';

    const handle = iniciarWorkers();

    expect(handle?.anexoDisponibilidadeWorker).toBeDefined();
    handle?.teardown();
  });

  it('QUEUE_TRANSPORT=sqs sem DATABASE_URL: matchingComposicao permanece null mesmo com filas do Matching configuradas', () => {
    process.env['WORKERS_ENABLED'] = 'true';
    process.env['QUEUE_TRANSPORT'] = 'sqs';
    process.env['ALERTAS_A_GRAVAR_QUEUE_URL'] = 'https://sqs.local/000/alertas-a-gravar';
    process.env['ALERTAS_GERADOS_QUEUE_URL'] = 'https://sqs.local/000/alertas-gerados';

    const handle = iniciarWorkers();

    expect(handle?.matchingComposicao).toBeNull();
    handle?.teardown();
  });
});
