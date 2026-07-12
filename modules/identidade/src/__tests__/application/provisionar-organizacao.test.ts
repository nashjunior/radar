import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import type { TenantRepository, PermissaoRepository, TenantIdProvider, EventPublisher } from '../../application/ports.js';
import { ProvisionarOrganizacaoUseCase } from '../../application/use-cases/provisionar-organizacao.js';
import type { ProvisionarOrganizacaoInput } from '../../application/use-cases/provisionar-organizacao.js';
import { Tenant } from '../../domain/tenant.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { AtribuicaoPapel, UsuarioId } from '../../domain/atribuicao-papel.js';
import { CnpjInvalidoError, OrganizacaoJaExisteError, UsuarioJaVinculadoError } from '../../domain/errors.js';

const noop = new AbortController().signal;
const CNPJ_VALIDO = '11222333000181';
const SUB = 'sub-novo-usuario';
const INPUT: ProvisionarOrganizacaoInput = {
  sub: SUB,
  email: 'contato@empresa.com',
  cnpj: CNPJ_VALIDO,
  razaoSocial: 'Empresa Fornecedora LTDA',
};

function deps() {
  const tenants: TenantRepository = {
    porId: vi.fn().mockResolvedValue(null),
    porCnpj: vi.fn().mockResolvedValue(null),
    salvar: vi.fn().mockResolvedValue(undefined),
  };
  const permissoes: PermissaoRepository = {
    buscarPorUsuario: vi.fn().mockResolvedValue(null),
    criar: vi.fn().mockResolvedValue(undefined),
  };
  let contador = 0;
  const tenantIds: TenantIdProvider = {
    gerar: () => TenantId(`tenant-gerado-${++contador}`),
  };
  const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
  return { tenants, permissoes, tenantIds, eventos };
}

describe('ProvisionarOrganizacaoUseCase', () => {
  it('cria Tenant + AtribuicaoPapel ADMIN_CONSULTORIA e publica organizacao.provisionada', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);

    const dto = await uc.executar(INPUT, noop);

    expect(dto).toEqual({
      tenantId: TenantId('tenant-gerado-1'),
      cnpj: CNPJ_VALIDO,
      razaoSocial: 'Empresa Fornecedora LTDA',
      papel: 'ADMIN_CONSULTORIA',
    });
    expect(tenants.salvar).toHaveBeenCalledOnce();
    expect(permissoes.criar).toHaveBeenCalledOnce();
    const atribuicaoSalva = (permissoes.criar as ReturnType<typeof vi.fn>).mock.calls[0]![0] as AtribuicaoPapel;
    expect(atribuicaoSalva.usuarioId).toBe(UsuarioId(SUB));
    expect(atribuicaoSalva.papel).toBe('ADMIN_CONSULTORIA');
    expect(atribuicaoSalva.clienteFinalIds).toEqual([]);
    expect(eventos.publicar).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'organizacao.provisionada',
        payload: { tenantId: TenantId('tenant-gerado-1'), sub: SUB },
      }),
      noop,
    );
  });

  it('CNPJ inválido lança CnpjInvalidoError sem tocar os repositórios', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);

    await expect(uc.executar({ ...INPUT, cnpj: '123' }, noop)).rejects.toThrow(CnpjInvalidoError);
    expect(tenants.salvar).not.toHaveBeenCalled();
    expect(permissoes.criar).not.toHaveBeenCalled();
  });

  it('idempotente: sub já vinculado devolve a organização existente sem duplicar', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    const tenantExistente = Tenant.criar({
      id: TenantId('tenant-existente'),
      cnpj: Cnpj.criar(CNPJ_VALIDO),
      razaoSocial: 'Empresa Fornecedora LTDA',
    });
    const atribuicaoExistente = AtribuicaoPapel.criar({
      usuarioId: UsuarioId(SUB),
      tenantId: TenantId('tenant-existente'),
      papel: 'ADMIN_CONSULTORIA',
      clienteFinalIds: [],
    });
    (permissoes.buscarPorUsuario as ReturnType<typeof vi.fn>).mockResolvedValue(atribuicaoExistente);
    (tenants.porId as ReturnType<typeof vi.fn>).mockResolvedValue(tenantExistente);

    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);
    const dto = await uc.executar(INPUT, noop);

    expect(dto.tenantId).toBe(TenantId('tenant-existente'));
    expect(tenants.salvar).not.toHaveBeenCalled();
    expect(permissoes.criar).not.toHaveBeenCalled();
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('CNPJ já vinculado a outro tenant lança OrganizacaoJaExisteError', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    const tenantAlheio = Tenant.criar({
      id: TenantId('tenant-alheio'),
      cnpj: Cnpj.criar(CNPJ_VALIDO),
      razaoSocial: 'Outra Empresa',
    });
    (tenants.porCnpj as ReturnType<typeof vi.fn>).mockResolvedValue(tenantAlheio);

    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(OrganizacaoJaExisteError);
    expect(tenants.salvar).not.toHaveBeenCalled();
    expect(permissoes.criar).not.toHaveBeenCalled();
  });

  it('race na escrita de AtribuicaoPapel (UsuarioJaVinculadoError) recupera a organização já criada', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    const buscarPorUsuario = permissoes.buscarPorUsuario as ReturnType<typeof vi.fn>;
    const criar = permissoes.criar as ReturnType<typeof vi.fn>;

    let chamadas = 0;
    buscarPorUsuario.mockImplementation(async () => {
      chamadas += 1;
      if (chamadas === 1) return null; // checagem otimista inicial: ainda não vinculado
      return AtribuicaoPapel.criar({
        usuarioId: UsuarioId(SUB),
        tenantId: TenantId('tenant-gerado-1'),
        papel: 'ADMIN_CONSULTORIA',
        clienteFinalIds: [],
      });
    });
    criar.mockRejectedValue(new UsuarioJaVinculadoError());
    (tenants.porId as ReturnType<typeof vi.fn>).mockImplementation(async (id: unknown) =>
      id === TenantId('tenant-gerado-1')
        ? Tenant.criar({ id: TenantId('tenant-gerado-1'), cnpj: Cnpj.criar(CNPJ_VALIDO), razaoSocial: 'Empresa Fornecedora LTDA' })
        : null,
    );

    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);
    const dto = await uc.executar(INPUT, noop);

    expect(dto.tenantId).toBe(TenantId('tenant-gerado-1'));
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('conflito de unicidade de CNPJ na escrita propaga OrganizacaoJaExisteError', async () => {
    const { tenants, permissoes, tenantIds, eventos } = deps();
    (tenants.salvar as ReturnType<typeof vi.fn>).mockRejectedValue(new OrganizacaoJaExisteError());

    const uc = new ProvisionarOrganizacaoUseCase(tenants, permissoes, tenantIds, eventos);

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(OrganizacaoJaExisteError);
    expect(permissoes.criar).not.toHaveBeenCalled();
  });
});
