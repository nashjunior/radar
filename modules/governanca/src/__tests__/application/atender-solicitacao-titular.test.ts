/**
 * Testes do AtenderSolicitacaoTitularUseCase (RAD-98 / US-12 / P-57 / AB10 / docs/14 §5).
 *
 * Cobre: caso feliz (acesso/correcao/eliminacao), identidade não verificada (recusada),
 * fail-closed de auditoria, AbortSignal propagado, auditoria de cada transição.
 */
import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, TenantId } from '@radar/kernel';
import { AtenderSolicitacaoTitularUseCase } from '../../application/use-cases/atender-solicitacao-titular.js';
import { IdentidadeNaoVerificadaError } from '../../domain/entities/solicitacao-titular.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import { AuditLogId } from '../../domain/entities/registro-auditoria.js';
import type { AtenderSolicitacaoTitularInput } from '../../application/use-cases/atender-solicitacao-titular.js';
import type {
  AuditLogIdProvider,
  AuditLogRepository,
  IdentidadeGateway,
  SolicitacaoIdProvider,
  SolicitacaoTitularRepository,
} from '../../application/ports.js';
import { SolicitacaoId } from '../../domain/entities/solicitacao-titular.js';

const NOOP = new AbortController().signal;
const AGORA = new Date('2026-07-08T12:00:00Z');
const TENANT = TenantId('tenant-lgpd');
const CLIENTE = ClienteFinalId('cliente-lgpd');

let solSeq = 0;
let auditSeq = 0;

function deps(overrides: {
  verificarTitular?: ReturnType<typeof vi.fn>;
  salvar?: ReturnType<typeof vi.fn>;
  registrar?: ReturnType<typeof vi.fn>;
} = {}) {
  const verificarTitular =
    overrides.verificarTitular ??
    vi.fn().mockResolvedValue({ verificada: true, evidenciaRef: 'ev-001' });
  const salvar = overrides.salvar ?? vi.fn().mockResolvedValue(undefined);
  const registrar = overrides.registrar ?? vi.fn().mockResolvedValue(undefined);

  const solicitacoes: SolicitacaoTitularRepository = {
    salvar,
    porId: vi.fn().mockResolvedValue(null),
  };
  const identidadeGateway: IdentidadeGateway = { verificarTitular };
  const auditLog: AuditLogRepository = { registrar };
  const solicitacaoIdProvider: SolicitacaoIdProvider = {
    gerar: vi.fn().mockImplementation(() => SolicitacaoId(`sol-${++solSeq}`)),
  };
  const auditLogIdProvider: AuditLogIdProvider = {
    gerar: vi.fn().mockImplementation(() => AuditLogId(`audit-${++auditSeq}`)),
  };
  const clock = { agora: () => AGORA };

  return { solicitacoes, identidadeGateway, auditLog, solicitacaoIdProvider, auditLogIdProvider, clock, verificarTitular, salvar, registrar };
}

function buildInput(tipo: AtenderSolicitacaoTitularInput['tipo'] = 'acesso'): AtenderSolicitacaoTitularInput {
  return {
    tipo,
    tenantId: TENANT,
    clienteFinalId: CLIENTE,
    titularRef: 'titular-hash-abc',
    operadorId: 'dpo-operador',
  };
}

function buildUC(d: ReturnType<typeof deps>) {
  return new AtenderSolicitacaoTitularUseCase(
    d.solicitacoes,
    d.identidadeGateway,
    d.auditLog,
    d.solicitacaoIdProvider,
    d.auditLogIdProvider,
    d.clock,
  );
}

describe('AtenderSolicitacaoTitularUseCase — happy path', () => {
  it('tipo acesso: retorna SolicitacaoDTO com estado atendida', async () => {
    const d = deps();
    const dto = await buildUC(d).executar(buildInput('acesso'), NOOP);

    expect(dto.tipo).toBe('acesso');
    expect(dto.estado).toBe('atendida');
    expect(dto.solicitacaoId).toBeDefined();
    expect(dto.motivoRecusa).toBeUndefined();
  });

  it('tipo correcao: retorna estado atendida', async () => {
    const d = deps();
    const dto = await buildUC(d).executar(buildInput('correcao'), NOOP);
    expect(dto.tipo).toBe('correcao');
    expect(dto.estado).toBe('atendida');
  });

  it('tipo eliminacao: retorna estado atendida', async () => {
    const d = deps();
    const dto = await buildUC(d).executar(buildInput('eliminacao'), NOOP);
    expect(dto.tipo).toBe('eliminacao');
    expect(dto.estado).toBe('atendida');
  });

  it('persiste múltiplas transições de estado (recebida → atendida/encerrada)', async () => {
    const d = deps();
    await buildUC(d).executar(buildInput(), NOOP);

    // salvar é chamado em cada transição de estado
    expect(d.salvar.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('gera auditoria para cada etapa do fluxo (AB13/P-61)', async () => {
    const d = deps();
    await buildUC(d).executar(buildInput(), NOOP);

    // Deve ter no mínimo: criar, iniciar_verificacao, iniciar_analise, processamento, encerrar
    expect(d.registrar.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('verifica identidade com tenantId correto (P-51)', async () => {
    const d = deps();
    await buildUC(d).executar(buildInput(), NOOP);

    expect(d.verificarTitular).toHaveBeenCalledWith('titular-hash-abc', TENANT, CLIENTE, NOOP);
  });

  it('nega quando titular verificado não tem vínculo com clienteFinal do escopo (AB10/IDOR)', async () => {
    const d = deps({
      verificarTitular: vi.fn().mockResolvedValue({ verificada: true, vinculadoAoEscopo: false }),
    });

    await expect(buildUC(d).executar(buildInput(), NOOP)).rejects.toThrow(AcessoNegadoError);

    const acoes = d.registrar.mock.calls.map((c) => {
      const registro = c[0] as { acao: string };
      return registro.acao;
    });
    expect(acoes).toContain('RECUSAR_ESCOPO');
    expect(acoes).not.toContain('CONSULTAR');
  });
});

describe('AtenderSolicitacaoTitularUseCase — AB10/P-57 identidade não verificada', () => {
  it('lança IdentidadeNaoVerificadaError quando gateway rejeita', async () => {
    const d = deps({
      verificarTitular: vi.fn().mockResolvedValue({ verificada: false }),
    });

    await expect(buildUC(d).executar(buildInput(), NOOP)).rejects.toThrow(
      IdentidadeNaoVerificadaError,
    );
  });

  it('IdentidadeNaoVerificadaError tem code correto', async () => {
    const d = deps({
      verificarTitular: vi.fn().mockResolvedValue({ verificada: false }),
    });

    const err = await buildUC(d).executar(buildInput(), NOOP).catch((e) => e);
    expect(err.code).toBe('IDENTIDADE_NAO_VERIFICADA');
  });

  it('não retorna dados ao titular não verificado (nenhuma consulta de dados ocorre)', async () => {
    const d = deps({
      verificarTitular: vi.fn().mockResolvedValue({ verificada: false }),
    });

    await buildUC(d).executar(buildInput(), NOOP).catch(() => {});

    // Auditoria deve ter registrado recusa
    const acoes = d.registrar.mock.calls.map((c) => {
      const registro = c[0] as { acao: string };
      return registro.acao;
    });
    expect(acoes).toContain('RECUSAR_IDENTIDADE');
    // NÃO deve ter CONSULTAR (dado nunca foi acessado)
    expect(acoes).not.toContain('CONSULTAR');
  });

  it('persiste estado recusada + encerrada quando identidade falha', async () => {
    const d = deps({
      verificarTitular: vi.fn().mockResolvedValue({ verificada: false }),
    });

    await buildUC(d).executar(buildInput(), NOOP).catch(() => {});

    const estadosSalvos = d.salvar.mock.calls.map((c) => {
      const sol = c[0] as { estado: string };
      return sol.estado;
    });
    expect(estadosSalvos).toContain('recusada');
    expect(estadosSalvos).toContain('encerrada');

    // AB13/P-61: transição encerrada deve estar auditada mesmo no caminho de rejeição
    const acoesAuditadas = d.registrar.mock.calls.map((c) => {
      const registro = c[0] as { acao: string };
      return registro.acao;
    });
    expect(acoesAuditadas).toContain('RECUSAR_IDENTIDADE');
    expect(acoesAuditadas).toContain('ENCERRAR');
  });
});

describe('AtenderSolicitacaoTitularUseCase — fail-closed de auditoria (AB13/P-61)', () => {
  it('lança AuditoriaIndisponivelError quando AuditLogRepository falha', async () => {
    const d = deps({
      registrar: vi.fn().mockRejectedValue(new Error('banco indisponível')),
    });

    await expect(buildUC(d).executar(buildInput(), NOOP)).rejects.toThrow(
      AuditoriaIndisponivelError,
    );
  });

  it('AuditoriaIndisponivelError tem code correto', async () => {
    const d = deps({
      registrar: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    const err = await buildUC(d).executar(buildInput(), NOOP).catch((e) => e);
    expect(err.code).toBe('AUDITORIA_INDISPONIVEL');
  });

  it('não vaza erro interno — encapsula como AuditoriaIndisponivelError', async () => {
    const erroInterno = new Error('pg-pool explodiu');
    const d = deps({
      registrar: vi.fn().mockRejectedValue(erroInterno),
    });

    const capturado = await buildUC(d).executar(buildInput(), NOOP).catch((e) => e);
    expect(capturado).toBeInstanceOf(AuditoriaIndisponivelError);
    expect(capturado).not.toBe(erroInterno);
  });
});

describe('AtenderSolicitacaoTitularUseCase — AbortSignal (P-78)', () => {
  it('propaga signal ao IdentidadeGateway', async () => {
    const controller = new AbortController();
    const d = deps();
    await buildUC(d).executar(buildInput(), controller.signal);

    expect(d.verificarTitular).toHaveBeenCalledWith(
      expect.any(String),
      TENANT,
      CLIENTE,
      controller.signal,
    );
  });

  it('propaga signal ao SolicitacaoTitularRepository.salvar', async () => {
    const controller = new AbortController();
    const d = deps();
    await buildUC(d).executar(buildInput(), controller.signal);

    expect(d.salvar).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });
});
