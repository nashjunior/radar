import { describe, expect, it, vi } from 'vitest';
import { perguntarSobreLote } from '../ask.js';

describe('perguntarSobreLote', () => {
  it('recusa production', async () => {
    await expect(
      perguntarSobreLote({
        apiKey: 'k',
        modelo: 'gemini-2.0-flash',
        pergunta: 'oi',
        contextoEditais: '- x',
        nodeEnv: 'production',
      }),
    ).rejects.toThrow(/proibido/);
  });

  it('extrai texto da resposta Gemini', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Use o edital 12-1-0001/2026.' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const texto = await perguntarSobreLote({
      apiKey: 'k',
      modelo: 'gemini-2.0-flash',
      pergunta: 'o que serve?',
      contextoEditais: '- 12-1-0001/2026 | TI',
      nodeEnv: 'test',
      fetchFn,
    });
    expect(texto).toContain('12-1-0001/2026');
  });
});
