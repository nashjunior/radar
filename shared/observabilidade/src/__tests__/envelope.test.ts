import { describe, expect, it } from 'vitest';
import { comCorrelacao } from '../contexto-correlacao.js';
import { correlationIdDoEnvelope, envelopar } from '../envelope.js';
import { criarLogger } from '../logger.js';
import { extrairOuGerarTraceId, traceIdValido } from '../trace-context.js';

describe('envelope de evento (A18 §3.2)', () => {
  it('estampa o correlationId do escopo corrente', () => {
    const envelope = comCorrelacao('trace-do-escopo', () =>
      envelopar({ type: 'alerta.gerado', occurredAt: '2026-07-12T10:00:00.000Z', payload: { alertaId: 'a1' } }),
    );

    expect(envelope).toEqual({
      type: 'alerta.gerado',
      occurredAt: '2026-07-12T10:00:00.000Z',
      payload: { alertaId: 'a1' },
      correlationId: 'trace-do-escopo',
    });
  });

  it('gera um correlationId quando publicado fora de qualquer escopo de correlação', () => {
    const envelope = envelopar({ type: 'alerta.gerado', occurredAt: '2026-07-12T10:00:00.000Z', payload: {} });
    expect(traceIdValido(envelope.correlationId)).toBe(true);
  });

  it('correlationIdDoEnvelope aceita um correlationId válido do envelope', () => {
    const resultado = correlationIdDoEnvelope({ correlationId: '4bf92f3577b34da6a3ce929d0e0e4736' });
    expect(resultado).toEqual({ correlationId: '4bf92f3577b34da6a3ce929d0e0e4736', gerado: false });
  });

  it.each([
    ['ausente', undefined],
    ['formato inválido', 'nao-e-um-trace-id'],
    ['zerado', '0'.repeat(32)],
  ])('correlationIdDoEnvelope gera um novo quando o campo está %s (aditivo, não derruba o consumo)', (_desc, valor) => {
    const resultado = correlationIdDoEnvelope({ correlationId: valor });
    expect(resultado.gerado).toBe(true);
    expect(traceIdValido(resultado.correlationId)).toBe(true);
  });

  it('aceite A18: log da API e do worker carregam o MESMO correlationId ponta-a-ponta', () => {
    const linhasApi: string[] = [];
    const linhasWorker: string[] = [];
    const loggerApi = criarLogger('api', (linha) => linhasApi.push(linha));
    const loggerWorker = criarLogger('worker:notificacao', (linha) => linhasWorker.push(linha));

    // Ingresso na API: header traceparent do cliente vira o correlationId do escopo da requisição.
    const traceId = extrairOuGerarTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

    const envelope = comCorrelacao(traceId, () => {
      loggerApi.info('http.request', 'POST /alertas 202', { duracaoMs: 12 });
      // Publisher (infra): estampa o envelope a partir do ALS antes de publicar na fila.
      return envelopar({
        type: 'alerta.gerado',
        occurredAt: new Date(0).toISOString(),
        payload: { alertaId: 'a1' },
      });
    });

    // Fila entrega o envelope ao worker — consumidor (infra) re-entra no contexto antes do use case.
    const { correlationId, gerado } = correlationIdDoEnvelope(envelope);
    comCorrelacao(correlationId, () => {
      loggerWorker.info('notificacao.enviada', 'processado pelo worker');
    });

    expect(gerado).toBe(false);
    const registroApi = JSON.parse(linhasApi[0]!);
    const registroWorker = JSON.parse(linhasWorker[0]!);
    expect(registroApi.correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(registroWorker.correlationId).toBe(registroApi.correlationId);
  });

  it('aceite A18: correlationId inválido do cliente nunca aparece em log algum (log forging)', () => {
    const linhas: string[] = [];
    const logger = criarLogger('api', (linha) => linhas.push(linha));
    const forjado = 'ignorado\n[FORJADO] alguem-de-fora-controla-isso';

    const traceId = extrairOuGerarTraceId(forjado);
    comCorrelacao(traceId, () => logger.info('http.request', 'GET /saude 200'));

    expect(linhas[0]).not.toContain(forjado);
    expect(linhas[0]).not.toContain('FORJADO');
  });
});
