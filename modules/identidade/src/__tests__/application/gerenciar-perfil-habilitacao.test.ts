import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import { GerenciarPerfilHabilitacaoUseCase } from '../../application/use-cases/gerenciar-perfil-habilitacao.js';
import type { GerenciarPerfilInput } from '../../application/use-cases/gerenciar-perfil-habilitacao.js';
import type { EventPublisher, PerfilIdProvider, PerfilRepository } from '../../application/ports.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';

const noop = new AbortController().signal;

const TENANT = TenantId('global');
const CLIENTE = ClienteFinalId('cliente-1');
const PERFIL = PerfilId('perfil-1');

const INPUT: GerenciarPerfilInput = {
  tenantId: TENANT,
  clienteFinalId: CLIENTE,
  habJuridica: ['CND-Federal'],
  habFiscal: ['CND-Fiscal'],
  habTecnica: ['AT-001'],
  habEconomica: ['BS-001'],
};

const PERFIL_EXISTENTE = PerfilHabilitacao.criar({
  id: PERFIL,
  tenantId: TENANT,
  clienteFinalId: CLIENTE,
  habJuridica: ['OLD-J'],
  habFiscal: ['OLD-F'],
  habTecnica: ['OLD-T'],
  habEconomica: ['OLD-E'],
});

function deps(existente: PerfilHabilitacao | null) {
  const porClienteFinal = vi.fn().mockResolvedValue(existente);
  const salvar = vi.fn().mockResolvedValue(undefined);
  const gerar = vi.fn().mockReturnValue(PerfilId('perfil-novo'));
  const publicar = vi.fn().mockResolvedValue(undefined);
  const perfis: PerfilRepository = { porClienteFinal, salvar };
  const idProvider: PerfilIdProvider = { gerar };
  const eventos: EventPublisher = { publicar };
  return { perfis, idProvider, eventos, porClienteFinal, salvar, gerar, publicar };
}

describe('GerenciarPerfilHabilitacaoUseCase', () => {
  describe('criar novo perfil quando inexistente', () => {
    it('salva um novo PerfilHabilitacao com id gerado e retorna DTO', async () => {
      const { perfis, idProvider, eventos, salvar, gerar } = deps(null);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      const dto = await uc.executar(INPUT, noop);

      expect(gerar).toHaveBeenCalledOnce();
      expect(salvar).toHaveBeenCalledOnce();
      const [perfilSalvo] = salvar.mock.calls[0]!;
      expect(perfilSalvo).toBeInstanceOf(PerfilHabilitacao);
      expect(perfilSalvo.id).toBe('perfil-novo');
      expect(dto.id).toBe('perfil-novo');
      expect(dto.clienteFinalId).toBe(CLIENTE);
      expect(dto.habJuridica).toEqual(['CND-Federal']);
    });

    it('emite perfil.atualizado com o id novo (P-78 signal propagado)', async () => {
      const { perfis, idProvider, eventos, publicar } = deps(null);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await uc.executar(INPUT, noop);

      expect(publicar).toHaveBeenCalledOnce();
      const [evento, signal] = publicar.mock.calls[0]!;
      expect(evento.type).toBe('perfil.atualizado');
      expect(evento.payload.perfilId).toBe('perfil-novo');
      expect(evento.payload.tenantId).toBe(TENANT);
      expect(evento.payload.clienteFinalId).toBe(CLIENTE);
      expect(signal).toBe(noop);
    });
  });

  describe('atualizar perfil existente', () => {
    it('substitui as dimensões e retorna DTO atualizado', async () => {
      const { perfis, idProvider, eventos, salvar, gerar } = deps(PERFIL_EXISTENTE);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      const dto = await uc.executar(INPUT, noop);

      expect(gerar).not.toHaveBeenCalled();
      expect(salvar).toHaveBeenCalledOnce();
      const [perfilSalvo] = salvar.mock.calls[0]!;
      expect(perfilSalvo.id).toBe(PERFIL);
      expect(perfilSalvo.habJuridica).toEqual(['CND-Federal']);
      expect(perfilSalvo.habFiscal).toEqual(['CND-Fiscal']);
      expect(dto.habTecnica).toEqual(['AT-001']);
      expect(dto.habEconomica).toEqual(['BS-001']);
    });

    it('emite perfil.atualizado mantendo o id original', async () => {
      const { perfis, idProvider, eventos, publicar } = deps(PERFIL_EXISTENTE);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await uc.executar(INPUT, noop);

      const [evento] = publicar.mock.calls[0]!;
      expect(evento.payload.perfilId).toBe(PERFIL);
    });
  });

  describe('autorização por objeto (P-51)', () => {
    it('lança AcessoNegadoError quando o perfil existente pertence a outro tenant', async () => {
      const perfilOutroTenant = PerfilHabilitacao.criar({
        id: PERFIL,
        tenantId: TenantId('outro-tenant'),
        clienteFinalId: CLIENTE,
        habJuridica: [],
        habFiscal: [],
        habTecnica: [],
        habEconomica: [],
      });
      const { perfis, idProvider, eventos, salvar, publicar } = deps(perfilOutroTenant);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
      expect(salvar).not.toHaveBeenCalled();
      expect(publicar).not.toHaveBeenCalled();
    });

    it('lança AcessoNegadoError quando o perfil existente pertence a outro clienteFinal', async () => {
      const perfilOutroCliente = PerfilHabilitacao.criar({
        id: PERFIL,
        tenantId: TENANT,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: [],
        habTecnica: [],
        habEconomica: [],
      });
      const { perfis, idProvider, eventos, salvar, publicar } = deps(perfilOutroCliente);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
      expect(salvar).not.toHaveBeenCalled();
      expect(publicar).not.toHaveBeenCalled();
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('propaga o signal para a consulta ao repositório', async () => {
      const { perfis, idProvider, eventos, porClienteFinal } = deps(null);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await uc.executar(INPUT, noop);

      expect(porClienteFinal).toHaveBeenCalledWith(TENANT, CLIENTE, noop);
    });

    it('propaga o signal ao salvar', async () => {
      const { perfis, idProvider, eventos, salvar } = deps(null);
      const uc = new GerenciarPerfilHabilitacaoUseCase(perfis, idProvider, eventos);

      await uc.executar(INPUT, noop);

      const [, signal] = salvar.mock.calls[0]!;
      expect(signal).toBe(noop);
    });
  });
});
