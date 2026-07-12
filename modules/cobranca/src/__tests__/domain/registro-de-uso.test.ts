import { describe, expect, it } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, RegistroDeUsoId, TenantId } from '@radar/kernel';
import { RegistroDeUso } from '../../domain/entities/registro-de-uso.js';

describe('RegistroDeUso', () => {
  it('cria registro com a chave natural completa', () => {
    const r = RegistroDeUso.criar({
      id: RegistroDeUsoId('registro-001'),
      tenantId: TenantId('tenant-001'),
      clienteFinalId: ClienteFinalId('cliente-001'),
      editalId: EditalId('edital-001'),
      perfilId: PerfilId('perfil-001'),
      periodo: '2026-07',
      confirmadoEm: new Date('2026-07-11T12:00:00Z'),
    });
    expect(r.tenantId).toBe('tenant-001');
    expect(r.clienteFinalId).toBe('cliente-001');
    expect(r.editalId).toBe('edital-001');
    expect(r.perfilId).toBe('perfil-001');
    expect(r.periodo).toBe('2026-07');
  });
});
