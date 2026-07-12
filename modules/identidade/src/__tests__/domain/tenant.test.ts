import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { Tenant } from '../../domain/tenant.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';

describe('Tenant', () => {
  it('cria com id, cnpj e razão social', () => {
    const cnpj = Cnpj.criar('11222333000181');
    const tenant = Tenant.criar({ id: TenantId('tenant-1'), cnpj, razaoSocial: '  Empresa LTDA  ' });

    expect(tenant.id).toBe(TenantId('tenant-1'));
    expect(tenant.cnpj.equals(cnpj)).toBe(true);
    expect(tenant.razaoSocial).toBe('Empresa LTDA');
  });
});
