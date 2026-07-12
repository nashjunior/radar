import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { PostgresTriagemRepository } from '../../infra/adapters/postgres-triagem-repository.js';
import { Triagem } from '../../domain/triagem.js';
import { Aderencia } from '../../domain/value-objects/aderencia.js';

const noop = new AbortController().signal;
const TENANT = TenantId('empresa-a');
const CLIENTE = ClienteFinalId('cliente-1');
const EDITAL = EditalId('edital-1');
const PERFIL = PerfilId('perfil-1');

function row(over?: Partial<Record<string, unknown>>) {
  return {
    tenant_id: 'empresa-a',
    cliente_final_id: 'cliente-1',
    edital_id: 'edital-1',
    perfil_id: 'perfil-1',
    aderencia: 0.5,
    recomendacao: 'no-go',
    riscos: [],
    ...over,
  };
}

/**
 * RAD-56 #2 — a chave única do agregado é (tenant, edital, perfil); a leitura DEVE escopar o WHERE por
 * tenant_id/cliente_final_id, senão (edital, perfil) não é único sob multi-tenant (A01 §6) e rows[0]
 * sem ORDER BY carregaria uma linha arbitrária de OUTRO tenant.
 */
describe('PostgresTriagemRepository.porEditalEPerfil — escopo por tenant/cliente', () => {
  it('filtra por tenant_id, cliente_final_id, edital_id, perfil_id (nessa ordem) e propaga o signal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()] });
    const repo = new PostgresTriagemRepository({ query });

    const triagem = await repo.porEditalEPerfil(TENANT, CLIENTE, EDITAL, PERFIL, noop);

    const [sql, params, opts] = query.mock.calls[0]!;
    const where = String(sql).replace(/\s+/g, ' ');
    expect(where).toContain(
      'WHERE tenant_id = $1 AND cliente_final_id = $2 AND edital_id = $3 AND perfil_id = $4',
    );
    expect(params).toEqual([TENANT, CLIENTE, EDITAL, PERFIL]); // escopo antes do sub-key
    expect(opts).toEqual({ signal: noop }); // P-78 — último hop chega ao driver
    expect(triagem).toBeInstanceOf(Triagem);
    expect(triagem!.tenantId).toBe(TENANT);
    expect(triagem!.aderencia!.equals(Aderencia.criar(0.5))).toBe(true);
  });

  it('sem linha no escopo → null (fail-closed: BFF 404), nunca uma linha de outro tenant', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTriagemRepository({ query });

    expect(await repo.porEditalEPerfil(TENANT, CLIENTE, EDITAL, PERFIL, noop)).toBeNull();
  });
});

/** P-110/RAD-281 — reenfileiramento cruza tenant/perfil, então filtra só por edital_id + status. */
describe('PostgresTriagemRepository.listarProcessandoPorEdital', () => {
  it('filtra por edital_id e status = processando, propaga o signal', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ status: 'processando', aderencia: null, recomendacao: null })] });
    const repo = new PostgresTriagemRepository({ query });

    const triagens = await repo.listarProcessandoPorEdital(EDITAL, noop);

    const [sql, params, opts] = query.mock.calls[0]!;
    const where = String(sql).replace(/\s+/g, ' ');
    expect(where).toContain("WHERE edital_id = $1 AND status = 'processando'");
    expect(params).toEqual([EDITAL]);
    expect(opts).toEqual({ signal: noop });
    expect(triagens).toHaveLength(1);
    expect(triagens[0]).toBeInstanceOf(Triagem);
  });

  it('edital sem triagem processando → array vazio', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTriagemRepository({ query });

    expect(await repo.listarProcessandoPorEdital(EDITAL, noop)).toEqual([]);
  });
});
