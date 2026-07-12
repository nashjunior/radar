import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { CasarEditalComCriteriosUseCase } from '../../application/use-cases/casar-edital-com-criterios.js';
import type {
  AlertaDevidoRepository,
  AlertaIdProvider,
  ClockProvider,
  CriterioRepository,
  FilaAlertaPort,
} from '../../application/ports.js';
import type { EditalParaMatchingDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;
const AGORA = new Date('2026-07-01T00:00:00.000Z');
const clock: ClockProvider = { agora: () => AGORA };

const editalFixture: EditalParaMatchingDTO = {
  id: EditalId('edital-001'),
  tenantScope: 'global',
  modalidadeCodigo: 1,
  objetoDescricao: 'Contratação de serviços de TI',
  uf: 'SP',
  cnae: '62.01',
  valorEstimado: 500_000,
  dataPublicacao: new Date('2026-07-01'),
  prazoProposta: null,
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

function mockAlertaDevidos(): AlertaDevidoRepository {
  return {
    registrarLote: vi.fn().mockResolvedValue(undefined),
    marcarNotificado: vi.fn().mockResolvedValue(undefined),
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

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
    const result = await uc.executar({ edital: editalFixture }, noop);

    expect(result).toHaveLength(0);
    expect(fila.enfileirar).not.toHaveBeenCalled();
  });

  it('enfileira alerta quando aderência supera limiar (≥ 0.3) — P-41/RAD-179', async () => {
    const criterio = criarCriterio('cliente-A');
    const fila = mockFilaAlerta();
    const criterios = mockCriterioRepo([criterio]);
    const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-alerta')) };

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
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

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());

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

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
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

    const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
    await uc.executar({ edital: editalFixture }, ac.signal);

    const [, signal] = (fila.enfileirar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, AbortSignal];
    expect(signal).toBe(ac.signal);
  });

  describe('prazo crítico (P-81, A18 §5.1) — imediato independente da aderência', () => {
    function criarCriterioAderenciaBaixa(): CriterioDeMonitoramento {
      // 'ti' casa, 'engenharia' não — score 1/2 = 0.5: supera o limiar (0.3) mas não é "alta" (0.8).
      return CriterioDeMonitoramento.criar({
        id: CriterioId('crit-001'),
        tenantId: TenantId('tenant-a'),
        clienteFinalId: ClienteFinalId('cliente-A'),
        palavrasChave: PalavrasChave.criar(['ti', 'engenharia']),
      });
    }

    it('gera alerta imediato quando o edital tem prazo em 2 dias, mesmo com aderência baixa', async () => {
      const criterios = mockCriterioRepo([criarCriterioAderenciaBaixa()]);
      const fila = mockFilaAlerta();
      const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-prazo')) };

      const editalComPrazoCritico: EditalParaMatchingDTO = {
        ...editalFixture,
        prazoProposta: new Date('2026-07-03T00:00:00.000Z'), // 2 dias corridos após AGORA
      };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
      const result = await uc.executar({ edital: editalComPrazoCritico }, noop);

      expect(result).toHaveLength(1);
      expect(result[0]?.aderencia).toBeLessThan(0.8);
      expect(result[0]?.imediato).toBe(true);

      const [payload] = (fila.enfileirar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
      expect(payload).toMatchObject({ prazoCritico: true });
    });

    it('não gera alerta imediato quando a aderência é baixa e o prazo não é crítico', async () => {
      const criterios = mockCriterioRepo([criarCriterioAderenciaBaixa()]);
      const fila = mockFilaAlerta();
      const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-longe')) };

      const editalPrazoLonge: EditalParaMatchingDTO = {
        ...editalFixture,
        prazoProposta: new Date('2026-08-01T00:00:00.000Z'),
      };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, mockAlertaDevidos());
      const result = await uc.executar({ edital: editalPrazoLonge }, noop);

      expect(result[0]?.imediato).toBe(false);
      const [payload] = (fila.enfileirar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown];
      expect(payload).toMatchObject({ prazoCritico: false });
    });
  });

  describe('projeção de alertas devidos (P-114, A18 §5.2)', () => {
    it('registra os devidos de 1 edital com N critérios em 1 única chamada, N linhas', async () => {
      const criterioA = criarCriterio('cliente-A');
      const criterioB = CriterioDeMonitoramento.criar({
        id: CriterioId('crit-002'),
        tenantId: TenantId('tenant-a'),
        clienteFinalId: ClienteFinalId('cliente-B'),
        palavrasChave: PalavrasChave.criar(['ti']),
      });
      const criterios = mockCriterioRepo([criterioA, criterioB]);
      const fila = mockFilaAlerta();
      const alertaDevidos = mockAlertaDevidos();
      let idCounter = 0;
      const ids: AlertaIdProvider = { gerar: vi.fn().mockImplementation(() => AlertaId(`uuid-${++idCounter}`)) };

      const editalComPrazo: EditalParaMatchingDTO = {
        ...editalFixture,
        prazoProposta: new Date('2026-08-01T00:00:00.000Z'),
      };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, alertaDevidos);
      await uc.executar({ edital: editalComPrazo }, noop);

      expect(alertaDevidos.registrarLote).toHaveBeenCalledOnce();
      const [devidos] = (alertaDevidos.registrarLote as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
      expect(devidos).toHaveLength(2);
      expect(devidos).toContainEqual(expect.objectContaining({ tenantId: 'tenant-a', prazoProposta: editalComPrazo.prazoProposta }));
    });

    it('não registra devido quando prazoProposta é null — não há janela a medir', async () => {
      const criterio = criarCriterio('cliente-A');
      const criterios = mockCriterioRepo([criterio]);
      const fila = mockFilaAlerta();
      const alertaDevidos = mockAlertaDevidos();
      const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, alertaDevidos);
      const result = await uc.executar({ edital: editalFixture }, noop); // prazoProposta: null

      expect(result).toHaveLength(1);
      expect(alertaDevidos.registrarLote).not.toHaveBeenCalled();
    });

    it('não registra devido quando o edital não casa com nenhum critério', async () => {
      const criterioSemMatch = CriterioDeMonitoramento.criar({
        id: CriterioId('crit-001'),
        tenantId: TenantId('tenant-a'),
        clienteFinalId: ClienteFinalId('cliente-A'),
        palavrasChave: PalavrasChave.criar(['cloud', 'erp']),
      });
      const criterios = mockCriterioRepo([criterioSemMatch]);
      const fila = mockFilaAlerta();
      const alertaDevidos = mockAlertaDevidos();
      const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

      const editalComPrazo: EditalParaMatchingDTO = {
        ...editalFixture,
        prazoProposta: new Date('2026-08-01T00:00:00.000Z'),
      };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, alertaDevidos);
      const result = await uc.executar({ edital: editalComPrazo }, noop);

      expect(result).toHaveLength(0);
      expect(alertaDevidos.registrarLote).not.toHaveBeenCalled();
    });

    it('grava o devido ANTES de enfileirar — falha ao enfileirar não apaga o devido já registrado', async () => {
      const criterio = criarCriterio('cliente-A');
      const criterios = mockCriterioRepo([criterio]);
      const alertaDevidos = mockAlertaDevidos();
      const ids: AlertaIdProvider = { gerar: vi.fn().mockReturnValue(AlertaId('uuid-1')) };

      const chamadas: string[] = [];
      (alertaDevidos.registrarLote as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        chamadas.push('registrarLote');
      });
      const fila: FilaAlertaPort = {
        enfileirar: vi.fn().mockImplementation(async () => {
          chamadas.push('enfileirar');
          throw new Error('falha simulada ao enfileirar (SQS indisponível)');
        }),
        drenar: vi.fn().mockResolvedValue([]),
      };

      const editalComPrazo: EditalParaMatchingDTO = {
        ...editalFixture,
        prazoProposta: new Date('2026-08-01T00:00:00.000Z'),
      };

      const uc = new CasarEditalComCriteriosUseCase(criterios, fila, ids, clock, alertaDevidos);

      await expect(uc.executar({ edital: editalComPrazo }, noop)).rejects.toThrow('falha simulada');
      expect(chamadas).toEqual(['registrarLote', 'enfileirar']);
    });
  });
});
