import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';
import type {
  AlertaIdProvider,
  AlertaRepository,
  CriterioRepository,
  EventPublisher,
} from '../../application/ports.js';
import type { EditalParaMatchingDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;

const editalFixture: EditalParaMatchingDTO = {
  id: EditalId('edital-001'),
  tenantScope: 'global',
  modalidadeCodigo: 1,
  objetoDescricao: 'Contratação de serviços de TI',
  uf: 'SP',
  cnae: '62.01',
  valorEstimado: 500_000,
  dataPublicacao: new Date('2026-07-01'),
};

const editalComProveniencia: EditalParaMatchingDTO = {
  ...editalFixture,
  proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', dataColeta: '2026-07-09T00:00:00.000Z' },
};

function criarCriterio(clienteFinalId: string): CriterioDeMonitoramento {
  return CriterioDeMonitoramento.criar({
    id: CriterioId('crit-001'),
    tenantId: TenantId('tenant-a'),
    clienteFinalId: ClienteFinalId(clienteFinalId),
    palavrasChave: PalavrasChave.criar(['ti']),
  });
}

describe('CasarEditalComCriteriosUseCase', () => {
  it('retorna lista vazia quando nenhum critério supera o limiar de aderência (< 0.3)', async () => {
    const criterio = criarCriterio('cliente-A');
    const criterios: CriterioRepository = {
      salvar: vi.fn(),
      porId: vi.fn(),
      listarAtivos: vi.fn(),
      casarComEdital: vi.fn().mockResolvedValue([{ criterio, score: 0.1 }]),
    };
    const alertas: AlertaRepository = { salvar: vi.fn(), porId: vi.fn(), atualizarFeedback: vi.fn(), listarPorTenant: vi.fn() };
    const eventos: EventPublisher = { publicar: vi.fn() };
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, alertas, eventos, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(0);
    expect(alertas.salvar).not.toHaveBeenCalled();
  });

  it('gera alerta quando score supera limiar (≥ 0.3) e persiste + publica evento', async () => {
    const criterio = criarCriterio('cliente-A');
    const salvarAlerta = vi.fn().mockResolvedValue(undefined);
    const publicar = vi.fn().mockResolvedValue(undefined);

    const criterios: CriterioRepository = {
      salvar: vi.fn(),
      porId: vi.fn(),
      listarAtivos: vi.fn(),
      casarComEdital: vi.fn().mockResolvedValue([{ criterio, score: 0.75 }]),
    };
    const alertas: AlertaRepository = { salvar: salvarAlerta, porId: vi.fn(), atualizarFeedback: vi.fn(), listarPorTenant: vi.fn() };
    const eventos: EventPublisher = { publicar };
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-alerta')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, alertas, eventos, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(1);
    expect(result[0]?.aderencia).toBe(0.75);
    expect(salvarAlerta).toHaveBeenCalledOnce();
    expect(publicar).toHaveBeenCalledOnce();
  });

  it('projeta proveniencia no AlertaDTO quando edital a contém (RAD-115)', async () => {
    const criterio = criarCriterio('cliente-A');
    const criterios: CriterioRepository = {
      salvar: vi.fn(),
      porId: vi.fn(),
      listarAtivos: vi.fn(),
      casarComEdital: vi.fn().mockResolvedValue([{ criterio, score: 0.8 }]),
    };
    const alertas: AlertaRepository = { salvar: vi.fn().mockResolvedValue(undefined), porId: vi.fn(), atualizarFeedback: vi.fn(), listarPorTenant: vi.fn() };
    const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-prov')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, alertas, eventos, ids);

    const comProv = await uc.executar({ edital: editalComProveniencia }, noop);
    expect(comProv[0]?.proveniencia).toEqual({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', dataColeta: '2026-07-09T00:00:00.000Z' });

    const semProv = await uc.executar({ edital: editalFixture }, noop);
    expect(semProv[0]?.proveniencia).toBeUndefined();
  });

  it('gera alertas separados para critérios de clientes distintos — sem cross-tenant', async () => {
    const criterioA = criarCriterio('cliente-A');
    const criterioB = CriterioDeMonitoramento.criar({
      id: CriterioId('crit-002'),
      tenantId: TenantId('tenant-a'),
      clienteFinalId: ClienteFinalId('cliente-B'),
      palavrasChave: PalavrasChave.criar(['ti']),
    });

    const criterios: CriterioRepository = {
      salvar: vi.fn(),
      porId: vi.fn(),
      listarAtivos: vi.fn(),
      casarComEdital: vi.fn().mockResolvedValue([
        { criterio: criterioA, score: 0.8 },
        { criterio: criterioB, score: 0.6 },
      ]),
    };
    const alertas: AlertaRepository = { salvar: vi.fn().mockResolvedValue(undefined), porId: vi.fn(), atualizarFeedback: vi.fn(), listarPorTenant: vi.fn() };
    const eventos: EventPublisher = { publicar: vi.fn().mockResolvedValue(undefined) };
    let idCounter = 0;
    const ids: AlertaIdProvider = { gerar: vi.fn().mockImplementation(() => AlertaId(`uuid-${++idCounter}`)) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, alertas, eventos, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(2);
    const clienteFinals = result.map(a => a.clienteFinalId);
    expect(clienteFinals).toContain('cliente-A');
    expect(clienteFinals).toContain('cliente-B');
  });
});
