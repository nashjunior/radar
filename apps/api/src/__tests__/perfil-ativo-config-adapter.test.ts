import { describe, expect, it } from 'vitest';
import { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import { PerfilAtivoConfigAdapter } from '../infra/perfil-ativo-config-adapter.js';

const TENANT = TenantId('tenant-abc');
const CLIENTE = ClienteFinalId('cliente-001');
const PERFIL = PerfilId('perfil-001');

const SEED_VALIDA = JSON.stringify({
  'tenant-abc': { clienteFinalId: 'cliente-001', perfilId: 'perfil-001' },
  'tenant-xyz': { clienteFinalId: 'cliente-002', perfilId: 'perfil-002' },
});

describe('PerfilAtivoConfigAdapter', () => {
  describe('fromJson — parsing', () => {
    it('constrói adapter a partir de JSON válido', () => {
      expect(() => PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA)).not.toThrow();
    });

    it('lança erro se JSON for inválido', () => {
      expect(() => PerfilAtivoConfigAdapter.fromJson('{')).toThrow('TENANT_SEED: JSON inválido.');
    });

    it('lança erro se JSON não for objeto', () => {
      expect(() => PerfilAtivoConfigAdapter.fromJson('"texto"')).toThrow('TENANT_SEED: deve ser um objeto JSON');
    });

    it('lança erro se JSON for array', () => {
      expect(() => PerfilAtivoConfigAdapter.fromJson('[]')).toThrow('TENANT_SEED: deve ser um objeto JSON');
    });

    it('lança erro se entrada de tenant não tiver clienteFinalId', () => {
      const seed = JSON.stringify({ 'tenant-abc': { perfilId: 'perfil-001' } });
      expect(() => PerfilAtivoConfigAdapter.fromJson(seed)).toThrow('tenant-abc');
    });

    it('lança erro se entrada de tenant não tiver perfilId', () => {
      const seed = JSON.stringify({ 'tenant-abc': { clienteFinalId: 'cliente-001' } });
      expect(() => PerfilAtivoConfigAdapter.fromJson(seed)).toThrow('tenant-abc');
    });

    it('lança erro se clienteFinalId for string vazia', () => {
      const seed = JSON.stringify({ 'tenant-abc': { clienteFinalId: '', perfilId: 'perfil-001' } });
      expect(() => PerfilAtivoConfigAdapter.fromJson(seed)).toThrow('tenant-abc');
    });

    it('aceita JSON vazio — zero tenants cadastrados', () => {
      expect(() => PerfilAtivoConfigAdapter.fromJson('{}')).not.toThrow();
    });
  });

  describe('resolverParaTenant', () => {
    it('retorna clienteFinalId e perfilId para tenant conhecido', async () => {
      const adapter = PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA);
      const resultado = await adapter.resolverParaTenant(TENANT, new AbortController().signal);

      expect(resultado).not.toBeNull();
      expect(resultado!.clienteFinalId).toBe(CLIENTE);
      expect(resultado!.perfilId).toBe(PERFIL);
    });

    it('retorna null para tenant desconhecido (MVP: borda mapeia para 401/404)', async () => {
      const adapter = PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA);
      const resultado = await adapter.resolverParaTenant(TenantId('tenant-inexistente'), new AbortController().signal);

      expect(resultado).toBeNull();
    });

    it('resolve tenant-xyz corretamente (múltiplos tenants no seed)', async () => {
      const adapter = PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA);
      const resultado = await adapter.resolverParaTenant(TenantId('tenant-xyz'), new AbortController().signal);

      expect(resultado!.clienteFinalId).toBe(ClienteFinalId('cliente-002'));
      expect(resultado!.perfilId).toBe(PerfilId('perfil-002'));
    });

    it('propaga AbortSignal — lança se já abortado (P-78)', async () => {
      const adapter = PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA);
      const controller = new AbortController();
      controller.abort();

      await expect(adapter.resolverParaTenant(TENANT, controller.signal)).rejects.toThrow();
    });

    it('não lança se signal estiver ativo', async () => {
      const adapter = PerfilAtivoConfigAdapter.fromJson(SEED_VALIDA);
      const controller = new AbortController();

      await expect(adapter.resolverParaTenant(TENANT, controller.signal)).resolves.not.toBeNull();
    });
  });
});
