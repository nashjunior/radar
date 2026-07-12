import { describe, expect, it } from 'vitest';
import { comCorrelacao, correlationIdAtual } from '../contexto-correlacao.js';

describe('contexto de correlação (AsyncLocalStorage — A18 §3.3)', () => {
  it('não tem correlationId fora de qualquer escopo', () => {
    expect(correlationIdAtual()).toBeUndefined();
  });

  it('expõe o correlationId dentro do escopo de comCorrelacao', () => {
    const resultado = comCorrelacao('abc123', () => correlationIdAtual());
    expect(resultado).toBe('abc123');
  });

  it('some de novo após o escopo terminar', () => {
    comCorrelacao('abc123', () => undefined);
    expect(correlationIdAtual()).toBeUndefined();
  });

  it('atravessa awaits assíncronos dentro do mesmo escopo', async () => {
    const resultado = await comCorrelacao('async-id', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return correlationIdAtual();
    });
    expect(resultado).toBe('async-id');
  });

  it('isola escopos concorrentes (uma requisição não vaza o correlationId da outra)', async () => {
    const rodar = (id: string) =>
      comCorrelacao(id, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        return correlationIdAtual();
      });

    const [a, b] = await Promise.all([rodar('req-a'), rodar('req-b')]);
    expect(a).toBe('req-a');
    expect(b).toBe('req-b');
  });
});
