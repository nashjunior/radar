import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { PostgresAssinaturaRepository } from '../../infra/adapters/postgres-assinatura-repository.js';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const SIGNAL = new AbortController().signal;
const TENANT = TenantId('tenant-pg-1');

describe('PostgresAssinaturaRepository.reservarCota — UPDATE atômico único (P-107 (3))', () => {
  it('faz um único UPDATE com status IN (ativa,trial) e uso_reservado < cota, sem SELECT prévio', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const repo = new PostgresAssinaturaRepository({ query });

    const concedida = await repo.reservarCota(TENANT, SIGNAL);

    expect(concedida).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('UPDATE assinatura');
    expect(texto).toContain('uso_reservado = uso_reservado + 1');
    expect(texto).toContain("status IN ('ativa', 'trial')");
    expect(texto).toContain('uso_reservado < cota_triagens_mes');
    expect(texto).toContain("(status <> 'trial' OR periodo_fim > now())"); // RAD-277 — trial vencido não passa
    expect(texto).not.toContain('SELECT');
    expect(params).toEqual([TENANT]);
    expect(opts).toEqual({ signal: SIGNAL });
  });

  it('retorna false quando 0 linhas afetadas (cota esgotada ou assinatura fora do gate)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresAssinaturaRepository({ query });

    await expect(repo.reservarCota(TENANT, SIGNAL)).resolves.toBe(false);
  });

  it('carência do ciclo `ativa` vencido é por tempo/teto — nunca escreve periodo_*/uso_confirmado (RAD-290, corrige RAD-287)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const repo = new PostgresAssinaturaRepository({ query });

    await repo.reservarCota(TENANT, SIGNAL);

    const [sql] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain("status = 'ativa' AND periodo_fim <= now()");
    expect(texto).toMatch(/now\(\)\s*<\s*periodo_fim\s*\+\s*INTERVAL '\d+ days'/);
    expect(texto).toContain('uso_reservado < cota_triagens_mes * 2');
    // Invariante restaurado: só `invoice.paid` (renovarCiclo) muda o relógio do ciclo.
    expect(texto).not.toContain('periodo_fim =');
    expect(texto).not.toContain('periodo_inicio =');
    expect(texto).not.toContain('uso_confirmado =');
  });
});

describe('PostgresAssinaturaRepository.liberarReserva — compensação (P-107 (c))', () => {
  it('usa GREATEST(uso_reservado - 1, 0) — nunca fica negativo', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresAssinaturaRepository({ query });

    await repo.liberarReserva(TENANT, SIGNAL);

    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('GREATEST(uso_reservado - 1, 0)');
    expect(params).toEqual([TENANT]);
    expect(opts).toEqual({ signal: SIGNAL });
  });
});

describe('PostgresAssinaturaRepository.confirmarUso — marca reserva como faturável, NÃO libera (RAD-275)', () => {
  it('incrementa uso_confirmado e NÃO mexe em uso_reservado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresAssinaturaRepository({ query });

    await repo.confirmarUso(TENANT, SIGNAL);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('UPDATE assinatura');
    expect(texto).toContain('uso_confirmado = uso_confirmado + 1');
    expect(texto).not.toContain('uso_reservado');
    expect(params).toEqual([TENANT]);
    expect(opts).toEqual({ signal: SIGNAL });
  });
});

describe('PostgresAssinaturaRepository.porTenantId / salvar', () => {
  it('reconstitui a Assinatura a partir da linha', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          tenant_id: TENANT,
          status: 'ativa',
          plano_codigo: 'starter',
          cota_triagens_mes: 30,
          preco_centavos: 12900,
          uso_reservado: 2,
          uso_confirmado: 1,
          periodo_inicio: '2026-01-01T00:00:00.000Z',
          periodo_fim: '2026-02-01T00:00:00.000Z',
          assinatura_externa_id: 'ext-123',
        },
      ],
    });
    const repo = new PostgresAssinaturaRepository({ query });

    const assinatura = await repo.porTenantId(TENANT, SIGNAL);

    expect(assinatura).not.toBeNull();
    expect(assinatura?.estado).toBe('ativa');
    expect(assinatura?.plano.codigo).toBe('starter');
    expect(assinatura?.usoReservado).toBe(2);
    expect(assinatura?.assinaturaExternaId).toBe('ext-123');
  });

  it('retorna null quando não há linha', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresAssinaturaRepository({ query });

    await expect(repo.porTenantId(TENANT, SIGNAL)).resolves.toBeNull();
  });

  it('salvar faz upsert por tenant_id (ON CONFLICT)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresAssinaturaRepository({ query });
    const cobrancaPlano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 30, precoCentavos: 12900 });
    const ciclo = CicloDeFaturamento.criar(new Date('2026-01-01'), new Date('2026-02-01'));
    const assinatura = Assinatura.iniciarTrial(TENANT, cobrancaPlano, ciclo);

    await repo.salvar(assinatura, SIGNAL);

    const [sql] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('INSERT INTO assinatura');
    expect(texto).toContain('ON CONFLICT (tenant_id) DO UPDATE SET');
  });
});
