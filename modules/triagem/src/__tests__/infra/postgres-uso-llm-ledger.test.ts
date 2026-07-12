import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { PostgresUsoLlmLedger } from '../../infra/adapters/postgres-uso-llm-ledger.js';
import { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';

const noop = new AbortController().signal;
const EDITAL = EditalId('edital-1');

/**
 * Ledger é APPEND-ONLY (RAD-230, P-20/P-38): sempre INSERT puro, NUNCA `ON CONFLICT`/UPDATE — ao
 * contrário de `PostgresTriagemRepository.salvar`. É essa diferença que corrige a Lacuna 2 do P-38.
 */
describe('PostgresUsoLlmLedger.registrar — sempre INSERT, nunca upsert', () => {
  it('insere sem ON CONFLICT e propaga o signal (P-78)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const ledger = new PostgresUsoLlmLedger({ query });

    const registro = RegistroUsoLlm.criar({
      editalId: EDITAL,
      tenantId: null,
      clienteFinalId: null,
      perfilId: null,
      modelo: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      custoUsd: 0.006,
      ocorridoEm: new Date('2026-07-11T00:00:00Z'),
    });

    await ledger.registrar(registro, noop);

    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('INSERT INTO registro_uso_llm');
    expect(texto).not.toContain('ON CONFLICT');
    expect(params).toEqual([
      EDITAL,
      null,
      null,
      null,
      'claude-sonnet-5',
      1000,
      200,
      0,
      0,
      0.006,
      registro.ocorridoEm,
    ]);
    expect(opts).toEqual({ signal: noop });
  });

  it('grava escopo de tenant quando presente (cache-miss de TriarEditalUseCase)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const ledger = new PostgresUsoLlmLedger({ query });
    const tenant = TenantId('t1');
    const cliente = ClienteFinalId('c1');
    const perfil = PerfilId('p1');

    const registro = RegistroUsoLlm.criar({
      editalId: EDITAL,
      tenantId: tenant,
      clienteFinalId: cliente,
      perfilId: perfil,
      modelo: 'claude-opus-4-8',
      inputTokens: 25000,
      outputTokens: 6000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      custoUsd: 0.275,
      ocorridoEm: new Date('2026-07-11T00:00:00Z'),
    });

    await ledger.registrar(registro, noop);

    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([EDITAL, tenant, cliente, perfil, 'claude-opus-4-8', 25000, 6000, 0, 0, 0.275, registro.ocorridoEm]);
  });
});

describe('PostgresUsoLlmLedger.gastoUsdNaJanela — orçamento acumulado (RAD-243)', () => {
  const desde = new Date('2026-07-10T00:00:00Z');

  it('escopo GLOBAL (tenantId: null): filtra só por ocorrido_em, tenant_id não entra no predicado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ soma: '12.5' }] });
    const ledger = new PostgresUsoLlmLedger({ query });

    const gasto = await ledger.gastoUsdNaJanela({ tenantId: null }, desde, noop);

    expect(gasto).toBe(12.5);
    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('SUM(custo_usd)');
    expect(texto).toContain('ocorrido_em >= $1');
    expect(params).toEqual([desde, null]);
    expect(opts).toEqual({ signal: noop });
  });

  it('escopo POR TENANT: passa o tenantId como parâmetro do predicado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ soma: '3.2' }] });
    const ledger = new PostgresUsoLlmLedger({ query });
    const tenant = TenantId('t1');

    const gasto = await ledger.gastoUsdNaJanela({ tenantId: tenant }, desde, noop);

    expect(gasto).toBe(3.2);
    const [, params] = query.mock.calls[0]!;
    expect(params).toEqual([desde, tenant]);
  });

  it('sem linhas na janela: soma NULL do SQL vira 0 (nunca NaN)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ soma: null }] });
    const ledger = new PostgresUsoLlmLedger({ query });

    const gasto = await ledger.gastoUsdNaJanela({ tenantId: null }, desde, noop);

    expect(gasto).toBe(0);
  });
});
