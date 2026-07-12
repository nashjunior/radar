import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { ConsultarAlertasTenantUseCase } from '../../application/use-cases/consultar-alertas-tenant.js';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { PrazoCritico } from '../../domain/value-objects/prazo-critico.js';
import type { AlertaRepository, EditalCatalogoPort } from '../../application/ports.js';

const TENANT = TenantId('t-001');
const noop = new AbortController().signal;

function makeAlerta(id: string): Alerta {
  return Alerta.reconstituir({
    id: AlertaId(id),
    tenantId: TENANT,
    clienteFinalId: ClienteFinalId('c-001'),
    criterioId: CriterioId('crit-001'),
    editalId: EditalId('edital-001'),
    aderencia: AderenciaMatching.criar(0.8),
    prazoCritico: PrazoCritico.reconstituir(false),
    relevante: null,
  });
}

function makeRepo(alertas: Alerta[]): AlertaRepository {
  return {
    listarPorTenant: vi.fn().mockResolvedValue(alertas),
    porId: vi.fn().mockResolvedValue(null),
    salvar: vi.fn(),
    salvarEmLote: vi.fn(),
    atualizarFeedback: vi.fn(),
  };
}

const catalogoVazio: EditalCatalogoPort = { porId: vi.fn().mockResolvedValue(null) };

const EDITAL_RESUMO = {
  modalidade: 'Pregão Eletrônico',
  titulo: 'Aquisição de notebooks',
  orgao: 'Ministério da Fazenda',
  valorEstimado: 150000,
  dataAbertura: '2026-08-01T10:00:00.000Z',
};

function makeCalalogoComEdital(): EditalCatalogoPort {
  return { porId: vi.fn().mockResolvedValue(EDITAL_RESUMO) };
}

// US-05 — ConsultarAlertasTenantUseCase
describe('ConsultarAlertasTenantUseCase', () => {
  it('retorna lista vazia quando não há alertas para o tenant', async () => {
    const repo = makeRepo([]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    const dtos = await uc.executar({ tenantId: TENANT }, noop);

    expect(dtos).toHaveLength(0);
    expect(repo.listarPorTenant).toHaveBeenCalledWith(TENANT, noop);
  });

  it('projeta alertas do domínio para AlertaDTO', async () => {
    const repo = makeRepo([makeAlerta('a-001'), makeAlerta('a-002')]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    const dtos = await uc.executar({ tenantId: TENANT }, noop);

    expect(dtos).toHaveLength(2);
    expect(dtos[0]!.id).toBe('a-001');
    expect(dtos[0]!.tenantId).toBe(TENANT);
    expect(dtos[0]!.aderencia).toBe(0.8);
    expect(dtos[0]!.relevante).toBeNull();
  });

  it('não expõe proveniencia quando ausente no alerta (opcional)', async () => {
    const repo = makeRepo([makeAlerta('a-001')]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    const [dto] = await uc.executar({ tenantId: TENANT }, noop);

    expect('proveniencia' in dto!).toBe(false);
  });

  it('propaga tenantId do JWT ao repositório (P-51)', async () => {
    const outro = TenantId('t-outro');
    const repo = makeRepo([]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    await uc.executar({ tenantId: outro }, noop);

    expect(repo.listarPorTenant).toHaveBeenCalledWith(outro, noop);
  });

  it('propaga AbortSignal ao repositório (P-78)', async () => {
    const ac = new AbortController();
    const repo = makeRepo([]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    await uc.executar({ tenantId: TENANT }, ac.signal);

    expect(repo.listarPorTenant).toHaveBeenCalledWith(TENANT, ac.signal);
  });

  // RAD-148 — Enriquecimento com dados do Catálogo
  it('enriquece AlertaDTO com dados do edital quando Catálogo retorna resumo', async () => {
    const repo = makeRepo([makeAlerta('a-001')]);
    const catalogo = makeCalalogoComEdital();
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogo);

    const [dto] = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto!.modalidade).toBe('Pregão Eletrônico');
    expect(dto!.titulo).toBe('Aquisição de notebooks');
    expect(dto!.orgao).toBe('Ministério da Fazenda');
    expect(dto!.valorEstimado).toBe(150000);
    expect(dto!.dataAbertura).toBe('2026-08-01T10:00:00.000Z');
  });

  it('omite campos de edital quando Catálogo retorna null (edital não encontrado)', async () => {
    const repo = makeRepo([makeAlerta('a-001')]);
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogoVazio);

    const [dto] = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto!.modalidade).toBeUndefined();
    expect(dto!.titulo).toBeUndefined();
    expect(dto!.orgao).toBeUndefined();
    expect(dto!.valorEstimado).toBeUndefined();
    expect(dto!.dataAbertura).toBeUndefined();
  });

  it('propaga AbortSignal ao Catálogo (P-78)', async () => {
    const ac = new AbortController();
    const repo = makeRepo([makeAlerta('a-001')]);
    const catalogo = makeCalalogoComEdital();
    const uc = new ConsultarAlertasTenantUseCase(repo, catalogo);

    await uc.executar({ tenantId: TENANT }, ac.signal);

    expect(catalogo.porId).toHaveBeenCalledWith(EditalId('edital-001'), ac.signal);
  });
});
