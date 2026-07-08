/**
 * Testes do AplicarRetencaoUseCase (RAD-101 / P-05 / P-44 / docs/05 §5).
 *
 * Cobre: caso feliz (eliminar + anonimizar), exceções legais, invariante AUDIT_LOG,
 * AbortSignal, fail-closed de auditoria, PRESERVAR skip, relatório correto.
 */
import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { AplicarRetencaoUseCase } from '../../application/use-cases/aplicar-retencao.js';
import type { AplicarRetencaoInput } from '../../application/use-cases/aplicar-retencao.js';
import type {
  ExpurgoCandidatoRepository,
  ExpurgoPort,
  AuditLogRepository,
  AuditLogIdProvider,
  PoliticaRetencao,
  CandidatoExpurgo,
} from '../../application/ports.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import { AuditLogId } from '../../domain/entities/registro-auditoria.js';

const NOOP = new AbortController().signal;
const AGORA = new Date('2026-07-08T00:00:00Z');
const TENANT = TenantId('tenant-xyz');

const POLITICA_SIMPLES: PoliticaRetencao = {
  versao: '2026-v1',
  conjuntos: [
    { conjunto: 'NOTIFICACAO_LOG', acao: 'ELIMINAR' },
    { conjunto: 'DADO_PESSOAL_TERCEIRO', acao: 'ANONIMIZAR' },
  ],
};

let idSeq = 0;

function deps(overrides: {
  listarElegiveis?: ReturnType<typeof vi.fn>;
  eliminar?: ReturnType<typeof vi.fn>;
  anonimizar?: ReturnType<typeof vi.fn>;
  registrar?: ReturnType<typeof vi.fn>;
} = {}) {
  const listarElegiveis = overrides.listarElegiveis ?? vi.fn().mockResolvedValue([]);
  const eliminar = overrides.eliminar ?? vi.fn().mockResolvedValue(undefined);
  const anonimizar = overrides.anonimizar ?? vi.fn().mockResolvedValue(undefined);
  const registrar = overrides.registrar ?? vi.fn().mockResolvedValue(undefined);

  const candidatos: ExpurgoCandidatoRepository = { listarElegiveis };
  const expurgo: ExpurgoPort = { eliminar, anonimizar };
  const auditLog: AuditLogRepository = { registrar };
  const idProvider: AuditLogIdProvider = {
    gerar: vi.fn().mockImplementation(() => AuditLogId(`audit-${++idSeq}`)),
  };
  const clock = { agora: () => AGORA };

  return { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis, eliminar, anonimizar, registrar };
}

function buildInput(politica: PoliticaRetencao = POLITICA_SIMPLES): AplicarRetencaoInput {
  return { politica, tenantId: TENANT, operadorId: 'job-retencao' };
}

describe('AplicarRetencaoUseCase — caminho feliz', () => {
  it('elimina itens do conjunto NOTIFICACAO_LOG e gera auditoria', async () => {
    const candidato: CandidatoExpurgo = { itemId: 'notif-001', conjunto: 'NOTIFICACAO_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar, registrar } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'NOTIFICACAO_LOG' ? [candidato] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(eliminar).toHaveBeenCalledOnce();
    expect(eliminar).toHaveBeenCalledWith('NOTIFICACAO_LOG', 'notif-001', NOOP);
    expect(registrar).toHaveBeenCalledOnce();
    expect(dto.aplicados).toBe(1);
    expect(dto.elegiveis).toBe(1);
    expect(dto.retidosPorExcecao).toBe(0);
    expect(dto.politicaVersao).toBe('2026-v1');
  });

  it('anonimiza itens do conjunto DADO_PESSOAL_TERCEIRO', async () => {
    const candidato: CandidatoExpurgo = { itemId: 'dp-001', conjunto: 'DADO_PESSOAL_TERCEIRO' };
    const { candidatos, expurgo, auditLog, idProvider, clock, anonimizar } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'DADO_PESSOAL_TERCEIRO' ? [candidato] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    await uc.executar(buildInput(), NOOP);

    expect(anonimizar).toHaveBeenCalledOnce();
    expect(anonimizar).toHaveBeenCalledWith('DADO_PESSOAL_TERCEIRO', 'dp-001', NOOP);
  });

  it('processa múltiplos candidatos por conjunto', async () => {
    const c1: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const c2: CandidatoExpurgo = { itemId: 'n2', conjunto: 'NOTIFICACAO_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar, registrar } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'NOTIFICACAO_LOG' ? [c1, c2] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(eliminar).toHaveBeenCalledTimes(2);
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(dto.aplicados).toBe(2);
    expect(dto.elegiveis).toBe(2);
  });

  it('retorna relatório vazio quando não há elegíveis', async () => {
    const { candidatos, expurgo, auditLog, idProvider, clock } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(dto.elegiveis).toBe(0);
    expect(dto.aplicados).toBe(0);
    expect(dto.retidosPorExcecao).toBe(0);
    expect(dto.resultados).toHaveLength(0);
  });

  it('inclui o tenantId correto na chamada ao repositório', async () => {
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    await uc.executar(buildInput(), NOOP);

    expect(listarElegiveis).toHaveBeenCalledWith('NOTIFICACAO_LOG', TENANT, NOOP);
  });
});

describe('AplicarRetencaoUseCase — exceções legais', () => {
  it('retém item com excecao LEGAL_HOLD sem chamar expurgo', async () => {
    const candidato: CandidatoExpurgo = {
      itemId: 'notif-leg',
      conjunto: 'NOTIFICACAO_LOG',
      excecao: 'LEGAL_HOLD',
    };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar, registrar } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'NOTIFICACAO_LOG' ? [candidato] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(eliminar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    expect(dto.retidosPorExcecao).toBe(1);
    expect(dto.aplicados).toBe(0);
    expect(dto.resultados[0]).toMatchObject({
      acao: 'RETIDO_POR_EXCECAO',
      excecao: 'LEGAL_HOLD',
    });
  });

  it('processa mix de itens normais e com exceção no mesmo conjunto', async () => {
    const c1: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const c2: CandidatoExpurgo = { itemId: 'n2', conjunto: 'NOTIFICACAO_LOG', excecao: 'AUDITORIA' };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'NOTIFICACAO_LOG' ? [c1, c2] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(eliminar).toHaveBeenCalledOnce();
    expect(eliminar).toHaveBeenCalledWith('NOTIFICACAO_LOG', 'n1', NOOP);
    expect(dto.aplicados).toBe(1);
    expect(dto.retidosPorExcecao).toBe(1);
    expect(dto.elegiveis).toBe(2);
  });
});

describe('AplicarRetencaoUseCase — invariante AUDIT_LOG (P-61/AB13)', () => {
  it('nunca elimina AUDIT_LOG mesmo que a política peça ELIMINAR', async () => {
    const politica: PoliticaRetencao = {
      versao: 'v-audit',
      conjuntos: [{ conjunto: 'AUDIT_LOG', acao: 'ELIMINAR' }],
    };
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis, eliminar } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), politica }, NOOP);

    expect(listarElegiveis).not.toHaveBeenCalled();
    expect(eliminar).not.toHaveBeenCalled();
    expect(dto.aplicados).toBe(0);
  });

  it('respeita ação ANONIMIZAR em AUDIT_LOG (processo controlado diferente de eliminar)', async () => {
    const politica: PoliticaRetencao = {
      versao: 'v-audit-anon',
      conjuntos: [{ conjunto: 'AUDIT_LOG', acao: 'ANONIMIZAR' }],
    };
    const candidato: CandidatoExpurgo = { itemId: 'al-001', conjunto: 'AUDIT_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis, anonimizar } = deps({
      listarElegiveis: vi.fn().mockResolvedValue([candidato]),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    await uc.executar({ ...buildInput(), politica }, NOOP);

    expect(listarElegiveis).toHaveBeenCalledWith('AUDIT_LOG', TENANT, NOOP);
    expect(anonimizar).toHaveBeenCalledOnce();
  });
});

describe('AplicarRetencaoUseCase — PRESERVAR skip', () => {
  it('pula conjuntos com ação PRESERVAR sem consultar o repositório', async () => {
    const politica: PoliticaRetencao = {
      versao: 'v-preservar',
      conjuntos: [{ conjunto: 'CATALOGO_PUBLICO', acao: 'PRESERVAR' }],
    };
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), politica }, NOOP);

    expect(listarElegiveis).not.toHaveBeenCalled();
    expect(dto.aplicados).toBe(0);
  });
});

describe('AplicarRetencaoUseCase — fail-closed de auditoria (AB13/P-61)', () => {
  it('lança AuditoriaIndisponivelError se AuditLogRepository falhar no expurgo', async () => {
    const candidato: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock } = deps({
      listarElegiveis: vi.fn().mockImplementation((c) => c === 'NOTIFICACAO_LOG' ? [candidato] : []),
      registrar: vi.fn().mockRejectedValue(new Error('banco fora do ar')),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    await expect(uc.executar(buildInput(), NOOP)).rejects.toThrow(AuditoriaIndisponivelError);
  });

  it('não vaza detalhe interno no AuditoriaIndisponivelError', async () => {
    const candidato: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const erroInterno = new Error('timeout pg-pool');
    const { candidatos, expurgo, auditLog, idProvider, clock } = deps({
      listarElegiveis: vi.fn().mockImplementation((c) => c === 'NOTIFICACAO_LOG' ? [candidato] : []),
      registrar: vi.fn().mockRejectedValue(erroInterno),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const capturado = await uc.executar(buildInput(), NOOP).catch((e) => e);

    expect(capturado).toBeInstanceOf(AuditoriaIndisponivelError);
    expect(capturado).not.toBe(erroInterno);
  });
});

describe('AplicarRetencaoUseCase — AbortSignal (P-78)', () => {
  it('para de processar conjuntos quando signal é abortado', async () => {
    const controller = new AbortController();
    const politica: PoliticaRetencao = {
      versao: 'v-abort',
      conjuntos: [
        { conjunto: 'NOTIFICACAO_LOG', acao: 'ELIMINAR' },
        { conjunto: 'NOTIFICACAO_LOG', acao: 'ELIMINAR' },
      ],
    };
    let firstCall = true;
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis } = deps({
      listarElegiveis: vi.fn().mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          controller.abort();
        }
        return [];
      }),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), politica }, controller.signal);

    // após abort, segunda iteração de conjuntos não é processada
    expect(listarElegiveis).toHaveBeenCalledTimes(1);
    expect(dto.aplicados).toBe(0);
  });

  it('propaga AbortSignal ao ExpurgoCandidatoRepository', async () => {
    const controller = new AbortController();
    const { candidatos, expurgo, auditLog, idProvider, clock, listarElegiveis } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    await uc.executar(buildInput(), controller.signal);

    expect(listarElegiveis).toHaveBeenCalledWith(
      expect.any(String),
      TENANT,
      controller.signal,
    );
  });
});

describe('AplicarRetencaoUseCase — modo simulação (dry-run)', () => {
  it('não chama expurgo nem auditoria em modoSimulacao', async () => {
    const candidato: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar, registrar } = deps({
      listarElegiveis: vi.fn().mockImplementation((c) =>
        c === 'NOTIFICACAO_LOG' ? [candidato] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), modoSimulacao: true }, NOOP);

    expect(eliminar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    expect(dto.aplicados).toBe(1);
    expect(dto.elegiveis).toBe(1);
  });

  it('relatório de simulação reflete elegíveis e exceções sem efeito colateral', async () => {
    const c1: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const c2: CandidatoExpurgo = { itemId: 'n2', conjunto: 'NOTIFICACAO_LOG', excecao: 'LEGAL_HOLD' };
    const { candidatos, expurgo, auditLog, idProvider, clock, eliminar } = deps({
      listarElegiveis: vi.fn().mockImplementation((c) =>
        c === 'NOTIFICACAO_LOG' ? [c1, c2] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), modoSimulacao: true }, NOOP);

    expect(eliminar).not.toHaveBeenCalled();
    expect(dto.elegiveis).toBe(2);
    expect(dto.aplicados).toBe(1);
    expect(dto.retidosPorExcecao).toBe(1);
  });
});

describe('AplicarRetencaoUseCase — relatório (RetencaoDTO)', () => {
  it('politicaVersao reflete a versão injetada', async () => {
    const politica: PoliticaRetencao = { versao: 'release-2026-07', conjuntos: [] };
    const { candidatos, expurgo, auditLog, idProvider, clock } = deps();
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar({ ...buildInput(), politica }, NOOP);

    expect(dto.politicaVersao).toBe('release-2026-07');
  });

  it('resultados contêm conjunto e ação de cada item processado', async () => {
    const c: CandidatoExpurgo = { itemId: 'n1', conjunto: 'NOTIFICACAO_LOG' };
    const { candidatos, expurgo, auditLog, idProvider, clock } = deps({
      listarElegiveis: vi.fn().mockImplementation((conjunto) =>
        conjunto === 'NOTIFICACAO_LOG' ? [c] : [],
      ),
    });
    const uc = new AplicarRetencaoUseCase(candidatos, expurgo, auditLog, idProvider, clock);

    const dto = await uc.executar(buildInput(), NOOP);

    expect(dto.resultados).toHaveLength(1);
    expect(dto.resultados[0]).toMatchObject({
      itemId: 'n1',
      conjunto: 'NOTIFICACAO_LOG',
      acao: 'ELIMINAR',
    });
  });
});
