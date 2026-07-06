import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import { ConsultarPerfilHabilitacaoUseCase } from '../../application/use-cases/consultar-perfil-habilitacao.js';
import type { PerfilRepository } from '../../application/ports.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';

const noop = new AbortController().signal;
const TENANT = TenantId('tenant-1');
const CLIENTE = ClienteFinalId('cliente-1');

function criarPerfil() {
  return PerfilHabilitacao.criar({
    id: PerfilId('perfil-1'),
    tenantId: TENANT,
    clienteFinalId: CLIENTE,
    habJuridica: ['doc-j'],
    habFiscal: [],
    habTecnica: ['ISO-9001'],
    habEconomica: [],
  });
}

function repo(perfil: PerfilHabilitacao | null): PerfilRepository {
  return { porClienteFinal: vi.fn().mockResolvedValue(perfil), salvar: vi.fn() };
}

describe('ConsultarPerfilHabilitacaoUseCase', () => {
  it('retorna DTO com as dimensões quando perfil existe', async () => {
    const uc = new ConsultarPerfilHabilitacaoUseCase(repo(criarPerfil()));
    const dto = await uc.executar({ tenantId: TENANT, clienteFinalId: CLIENTE }, noop);
    expect(dto).not.toBeNull();
    expect(dto!.clienteFinalId).toBe(CLIENTE);
    expect(dto!.habJuridica).toEqual(['doc-j']);
    expect(dto!.habTecnica).toEqual(['ISO-9001']);
  });

  it('retorna null quando perfil não existe', async () => {
    const uc = new ConsultarPerfilHabilitacaoUseCase(repo(null));
    const dto = await uc.executar({ tenantId: TENANT, clienteFinalId: CLIENTE }, noop);
    expect(dto).toBeNull();
  });

  it('DTO não expõe tenantId (P-101)', async () => {
    const uc = new ConsultarPerfilHabilitacaoUseCase(repo(criarPerfil()));
    const dto = await uc.executar({ tenantId: TENANT, clienteFinalId: CLIENTE }, noop);
    expect(dto).not.toHaveProperty('tenantId');
  });

  it('propaga AbortSignal ao repositório (P-78)', async () => {
    const porClienteFinal = vi.fn().mockResolvedValue(null);
    const uc = new ConsultarPerfilHabilitacaoUseCase({ porClienteFinal, salvar: vi.fn() });
    const controller = new AbortController();
    await uc.executar({ tenantId: TENANT, clienteFinalId: CLIENTE }, controller.signal);
    expect(porClienteFinal).toHaveBeenCalledWith(TENANT, CLIENTE, controller.signal);
  });
});
