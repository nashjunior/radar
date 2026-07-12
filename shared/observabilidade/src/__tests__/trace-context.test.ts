import { describe, expect, it } from 'vitest';
import { extrairOuGerarTraceId, gerarTraceId, traceIdValido } from '../trace-context.js';

describe('trace-context (W3C Trace Context — A18 §3.1)', () => {
  it('gera um trace-id de 32 hex minúsculo válido', () => {
    const id = gerarTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdValido(id)).toBe(true);
  });

  it('extrai o trace-id de um traceparent bem formado', () => {
    const traceId = extrairOuGerarTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it.each([
    ['ausente', undefined],
    ['nulo', null],
    ['vazio', ''],
    ['formato livre', 'nao-e-um-traceparent'],
    ['maiúsculo (fora da regra estrita)', '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01'],
    ['trace-id curto', '00-abc123-00f067aa0ba902b7-01'],
    ['trace-id zerado (inválido pelo W3C)', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
    ['injeção de log via header', 'ignorado\n[FORJADO] admin logado'],
  ])('descarta e gera um trace novo quando o traceparent é %s', (_descricao, entrada) => {
    const traceId = extrairOuGerarTraceId(entrada as string | undefined | null);
    expect(traceIdValido(traceId)).toBe(true);
    expect(traceId).not.toBe(entrada);
  });
});
