import { describe, expect, it, vi } from 'vitest';
import { PostgresWebhookEventoRepository } from '../../infra/adapters/postgres-webhook-evento-repository.js';

const SIGNAL = new AbortController().signal;

describe('PostgresWebhookEventoRepository — dedupe anti-replay (P-107 (5))', () => {
  it('primeira entrega: INSERT ON CONFLICT DO NOTHING retorna 1 linha ⇒ true', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const repo = new PostgresWebhookEventoRepository({ query });

    const primeira = await repo.registrarSePrimeiraVez('asaas', 'evt-1', SIGNAL);

    expect(primeira).toBe(true);
    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('INSERT INTO webhook_evento_processado');
    expect(texto).toContain('ON CONFLICT (provedor, evento_externo_id) DO NOTHING');
    expect(params).toEqual(['asaas', 'evt-1']);
    expect(opts).toEqual({ signal: SIGNAL });
  });

  it('replay: 0 linhas afetadas ⇒ false', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresWebhookEventoRepository({ query });

    await expect(repo.registrarSePrimeiraVez('asaas', 'evt-1', SIGNAL)).resolves.toBe(false);
  });
});
