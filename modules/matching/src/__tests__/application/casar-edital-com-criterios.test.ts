import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';
import type {
  AlertaIdProvider,
  CriterioRepository,
  FilaAlertaPort,
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

function mockCriterioRepo(criterios: CriterioDeMonitoramento[]): CriterioRepository {
  return {
    salvar: vi.fn(),
    porId: vi.fn(),
    listarAtivos: vi.fn().mockResolvedValue(criterios),
    listarPorTenant: vi.fn(),
  };
}

function mockFilaAlerta(): FilaAlertaPort {
  return {
    enfileirar: vi.fn().mockResolvedValue(undefined),
    drenar: vi.fn().mockResolvedValue([]),
  };
}

describe('CasarEditalComCriteriosUseCase', () => {
  it('retorna lista vazia quando nenhum critério supera o limiar de aderência (< 0.3)', async () => {
    const criterioSemMatch = CriterioDeMonitoramento.criar({
      id: CriterioId('crit-001'),
      tenantId: TenantId('tenant-a'),
      clienteFinalId: ClienteFinalId('cliente-A'),
      palavrasChave: PalavrasChave.criar(['cloud', 'erp']),
    });
    const criterios = mockCriterioRepo([criterioSemMatch]);
    const fila = mockFilaAlerta();
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(0);
    expect(fila.enfileirar).not.toHaveBeenCalled();
  });

  it('enfileira alerta quando aderência supera limiar (≥ 0.3) — P-41/RAD-179', async () => {
    const criterio = criarCriterio('cliente-A');
    const fila = mockFilaAlerta();
    const criterios = mockCriterioRepo([criterio]);
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-alerta')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(1);
    expect(result[0]?.aderencia).toBe(1);
    expect(fila.enfileirar).toHaveBeenCalledOnce();
    const [payload] = (fila.enfileirar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
    expect(payload).toMatchObject({
      alertaId: 'uuid-alerta',
      tenantId: 'tenant-a',
      clienteFinalId: 'cliente-A',
    });
  });

  it('projeta proveniencia no AlertaDTO quando edital a contém (RAD-115)', async () => {
    const criterio = criarCriterio('cliente-A');
    const criterios = mockCriterioRepo([criterio]);
    const fila = mockFilaAlerta();
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-prov')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids);

    const comProv = await uc.executar({ edital: editalComProveniencia }, noop);
    expect(comProv[0]?.proveniencia).toEqual({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', dataColeta: '2026-07-09T00:00:00.000Z' });

    const semProv = await uc.executar({ edital: editalFixture }, noop);
    expect(semProv[0]?.proveniencia).toBeUndefined();
  });

  it('enfileira alertas separados para critérios de clientes distintos — sem cross-tenant', async () => {
    const criterioA = criarCriterio('cliente-A');
    const criterioB = CriterioDeMonitoramento.criar({
      id: CriterioId('crit-002'),
      tenantId: TenantId('tenant-a'),
      clienteFinalId: ClienteFinalId('cliente-B'),
      palavrasChave: PalavrasChave.criar(['ti']),
    });

    const criterios = mockCriterioRepo([criterioA, criterioB]);
    const fila = mockFilaAlerta();
    let idCounter = 0;
    const ids: AlertaIdProvider = { gerar: vi.fn().mockImplementation(() => AlertaId(`uuid-${++idCounter}`)) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids);
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(2);
    const clienteFinals = result.map(a => a.clienteFinalId);
    expect(clienteFinals).toContain('cliente-A');
    expect(clienteFinals).toContain('cliente-B');
    expect(fila.enfileirar).toHaveBeenCalledTimes(2);
  });

  it('propaga AbortSignal ao enfileirar (P-78)', async () => {
    const ac = new AbortController();
    const criterio = criarCriterio('cliente-A');
    const criterios = mockCriterioRepo([criterio]);
    const fila = mockFilaAlerta();
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids);
    await uc.executar({ edital: editalFixture }, ac.signal);

    const [, signal] = (fila.enfileirar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, AbortSignal];
    expect(signal).toBe(ac.signal);
  });
});
