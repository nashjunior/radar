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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchingComposicao } from '@radar/matching/infra';
import type { TriagemBatchWorker } from '@radar/triagem/infra';
import { despacharEditalIngerido, iniciarWorkers } from '../workers.js';

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

/**
 * RAD-336 — antes desta correção, `TriagemBatchWorker` (pré-extração em lote, P-92/Lever 1) era
 * composto mas nunca alimentado: nenhum consumidor de `EDITAIS_INGERIDOS` chamava
 * `worker.enfileirar`. `despacharEditalIngerido` é o handler único que agora serve os dois
 * consumidores de `edital.ingerido` deste processo (SQS é competing-consumers, não pub/sub —
 * não dá pra ter uma segunda fila competindo pela mesma mensagem).
 */
describe('RAD-336 — despacharEditalIngerido', () => {
  const msg = {
    editalId: 'edital-336',
    objeto: 'Aquisição de notebooks',
    orgaoUf: 'SP',
    valorEstimado: 100_000,
    dataPublicacao: '2026-01-01T00:00:00.000Z',
    modalidadeCodigo: 6,
    prazoProposta: null,
  };
  const signal = new AbortController().signal;

  it('despacha para Matching e TriagemBatchWorker quando ambos estão de pé', async () => {
    const processar = vi.fn().mockResolvedValue(undefined);
    const enfileirar = vi.fn().mockResolvedValue(undefined);
    const matchingComposicao = { worker: { processar } } as unknown as MatchingComposicao;
    const triagemBatchWorker = { enfileirar } as unknown as TriagemBatchWorker;

    await despacharEditalIngerido(matchingComposicao, triagemBatchWorker, msg, signal);

    expect(processar).toHaveBeenCalledWith(msg, signal);
    expect(enfileirar).toHaveBeenCalledWith(msg, signal);
  });

  it('despacha só para TriagemBatchWorker quando Matching não está de pé (sem DATABASE_URL)', async () => {
    const enfileirar = vi.fn().mockResolvedValue(undefined);
    const triagemBatchWorker = { enfileirar } as unknown as TriagemBatchWorker;

    await despacharEditalIngerido(null, triagemBatchWorker, msg, signal);

    expect(enfileirar).toHaveBeenCalledWith(msg, signal);
  });

  it('despacha só para Matching quando ANTHROPIC_API_KEY está ausente (TriagemBatchWorker null)', async () => {
    const processar = vi.fn().mockResolvedValue(undefined);
    const matchingComposicao = { worker: { processar } } as unknown as MatchingComposicao;

    await despacharEditalIngerido(matchingComposicao, null, msg, signal);

    expect(processar).toHaveBeenCalledWith(msg, signal);
  });

  it('Matching lançar erro de infra não impede o despacho pra TriagemBatchWorker (isolamento de falha)', async () => {
    const erroInfra = new Error('Postgres indisponível');
    const processar = vi.fn().mockRejectedValue(erroInfra);
    const enfileirar = vi.fn().mockResolvedValue(undefined);
    const matchingComposicao = { worker: { processar } } as unknown as MatchingComposicao;
    const triagemBatchWorker = { enfileirar } as unknown as TriagemBatchWorker;

    await expect(despacharEditalIngerido(matchingComposicao, triagemBatchWorker, msg, signal)).rejects.toBe(erroInfra);

    expect(enfileirar).toHaveBeenCalledWith(msg, signal);
  });

  it('TriagemBatchWorker lançar não impede o despacho pro Matching (isolamento de falha, sentido inverso)', async () => {
    const erroTriagem = new Error('falha inesperada na Triagem');
    const processar = vi.fn().mockResolvedValue(undefined);
    const enfileirar = vi.fn().mockRejectedValue(erroTriagem);
    const matchingComposicao = { worker: { processar } } as unknown as MatchingComposicao;
    const triagemBatchWorker = { enfileirar } as unknown as TriagemBatchWorker;

    await expect(despacharEditalIngerido(matchingComposicao, triagemBatchWorker, msg, signal)).rejects.toBe(erroTriagem);

    expect(processar).toHaveBeenCalledWith(msg, signal);
  });
});
