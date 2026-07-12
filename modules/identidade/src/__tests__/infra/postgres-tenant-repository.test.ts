import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { PostgresTenantRepository } from '../../infra/adapters/postgres-tenant-repository.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { Tenant } from '../../domain/tenant.js';
import { OrganizacaoJaExisteError } from '../../domain/errors.js';

const SIGNAL = new AbortController().signal;
const CNPJ_VALIDO = '11222333000181';

describe('PostgresTenantRepository', () => {
  it('salvar: INSERT ON CONFLICT (cnpj) DO NOTHING retorna 1 linha ⇒ sucesso', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const repo = new PostgresTenantRepository({ query });
    const tenant = Tenant.criar({ id: TenantId('tenant-1'), cnpj: Cnpj.criar(CNPJ_VALIDO), razaoSocial: 'Empresa LTDA' });

    await repo.salvar(tenant, SIGNAL);

    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('INSERT INTO tenant');
    expect(texto).toContain('ON CONFLICT (cnpj) DO NOTHING');
    expect(params).toEqual(['tenant-1', CNPJ_VALIDO, 'Empresa LTDA']);
    expect(opts).toEqual({ signal: SIGNAL });
  });

  it('salvar: 0 linhas afetadas (CNPJ já existe) ⇒ OrganizacaoJaExisteError', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTenantRepository({ query });
    const tenant = Tenant.criar({ id: TenantId('tenant-1'), cnpj: Cnpj.criar(CNPJ_VALIDO), razaoSocial: 'Empresa LTDA' });

    await expect(repo.salvar(tenant, SIGNAL)).rejects.toThrow(OrganizacaoJaExisteError);
  });

  it('porId: mapeia a linha para Tenant', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'tenant-1', cnpj: CNPJ_VALIDO, razao_social: 'Empresa LTDA' }] });
    const repo = new PostgresTenantRepository({ query });

    const tenant = await repo.porId(TenantId('tenant-1'), SIGNAL);

    expect(tenant?.id).toBe(TenantId('tenant-1'));
    expect(tenant?.cnpj.valor).toBe(CNPJ_VALIDO);
    expect(tenant?.razaoSocial).toBe('Empresa LTDA');
  });

  it('porId: null quando não encontrado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTenantRepository({ query });

    await expect(repo.porId(TenantId('inexistente'), SIGNAL)).resolves.toBeNull();
  });

  it('porCnpj: consulta pelo valor normalizado do CNPJ', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresTenantRepository({ query });

    await repo.porCnpj(Cnpj.criar(CNPJ_VALIDO), SIGNAL);

    const [sql, params] = query.mock.calls[0]!;
    expect(String(sql)).toContain('WHERE cnpj = $1');
    expect(params).toEqual([CNPJ_VALIDO]);
  });
});
