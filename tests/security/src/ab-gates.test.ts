import { describe, expect, it, vi } from 'vitest';
import {
  AcessoNegadoError,
  AlertaId,
  ClienteFinalId,
  CriterioId,
  EditalId,
  PerfilId,
  TenantId,
} from '@radar/kernel';
import {
  AderenciaMatching,
  Alerta,
  ConsultarCriteriosTenantUseCase,
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import {
  CampoExtraido,
  Citacao,
  Confianca,
  ConsultarTriagemUseCase,
  ExtracaoEdital,
  PerfilHabilitacao as PerfilTriagem,
  RegistrarFeedbackTriagemUseCase,
  Requisito,
  SolicitarTriagemUseCase,
  Triagem,
  TriarEditalUseCase,
} from '@radar/triagem';
import {
  AtenderSolicitacaoTitularUseCase,
  AuditLogId,
  AuditoriaIndisponivelError,
  IdentidadeNaoVerificadaError,
  RegistrarAuditoriaUseCase,
  RegistroAuditoria,
  SolicitacaoId,
} from '@radar/governanca';
import {
  AtribuicaoPapel,
  AutorizarAcessoUseCase,
  ConsultarPerfilHabilitacaoUseCase,
  GerenciarPerfilHabilitacaoUseCase,
  PerfilHabilitacao as PerfilIdentidade,
  ResolverContextoAutorizacaoUseCase,
  UsuarioId as UsuarioIdIdentidade,
  podeExecutar,
} from '@radar/identidade';
import type { PermissaoRepository } from '@radar/identidade';
import { DefinirPreferenciasNotificacaoUseCase, UsuarioId } from '@radar/notificacao';
import {
  AnexoAprovado,
  AnexoQuarentenado,
  BaixarAnexosEditalUseCase,
  Edital,
  EscanearAnexoUseCase,
} from '@radar/ingestao';

const signal = new AbortController().signal;
const TENANT_A = TenantId('tenant-a');
const TENANT_B = TenantId('tenant-b');
const CLIENTE_A = ClienteFinalId('cliente-a');
const CLIENTE_B = ClienteFinalId('cliente-b');
const PERFIL = PerfilId('perfil-a');
const EDITAL = EditalId('edital-a');
const ALERTA = AlertaId('alerta-a');
const CRITERIO = CriterioId('criterio-a');

function perfilTriagem(clienteFinalId = CLIENTE_A): PerfilTriagem {
  return PerfilTriagem.de({
    id: PERFIL,
    clienteFinalId,
    habJuridica: [],
    habFiscal: ['CND'],
    habTecnica: [],
    habEconomica: [],
  });
}

function extracao(): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: CampoExtraido.criar({
      valor: 'Aquisição de notebooks',
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(1, 'objeto'),
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar<number | null>({
      valor: 250000,
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(1, 'valor estimado'),
      critico: true,
    }),
    dataAberturaPropostas: CampoExtraido.criar<Date | null>({
      valor: null,
      confianca: Confianca.criar(0.9),
      citacao: null,
      critico: false,
    }),
    requisitos: [Requisito.criar('fiscal', 'Certidão CND', null)],
    riscosBrutos: [],
    paginas: 1,
  });
}

function alerta(clienteFinalId = CLIENTE_A): Alerta {
  return Alerta.reconstituir({
    id: ALERTA,
    tenantId: clienteFinalId === CLIENTE_A ? TENANT_A : TENANT_B,
    clienteFinalId,
    criterioId: CRITERIO,
    editalId: EDITAL,
    aderencia: AderenciaMatching.criar(0.8),
    relevante: null,
  });
}

function perfilIdentidade(tenantId = TENANT_A, clienteFinalId = CLIENTE_A): PerfilIdentidade {
  return PerfilIdentidade.criar({
    id: PERFIL,
    tenantId,
    clienteFinalId,
    habJuridica: [],
    habFiscal: [],
    habTecnica: ['ISO-9001'],
    habEconomica: [],
  });
}

function edital(): Edital {
  return Edital.criar({
    id: EDITAL,
    numeroControlePncp: '00394502000167-1-000001/2024',
    anoCompra: 2024,
    sequencialCompra: 1,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Serviços de TI',
    valorEstimado: null,
    prazoProposta: null,
    dataPublicacao: new Date('2026-07-01T00:00:00Z'),
    dataAtualizacao: new Date('2026-07-01T00:00:00Z'),
    orgao: { cnpj: '11222333000181', nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date('2026-07-01T00:00:00Z') },
    itens: [],
  });
}

describe('Gate A07 · AB1/P-51 — matriz de autorização por objeto', () => {
  it('CRITERIO_MONITORAMENTO criar: DefinirCriterioMonitoramentoUseCase persiste no escopo autenticado', async () => {
    const repo = { salvar: vi.fn(), porId: vi.fn(), listarAtivos: vi.fn(), listarPorTenant: vi.fn() };
    const audit = { registrar: vi.fn().mockResolvedValue(undefined) };
    const uc = new DefinirCriterioMonitoramentoUseCase(
      repo,
      { faixasVigentes: vi.fn().mockResolvedValue([]) },
      { publicar: vi.fn() },
      { gerar: vi.fn().mockReturnValue(CRITERIO) },
      { agora: () => new Date('2026-07-10T00:00:00Z') },
      audit,
    );

    await uc.executar({
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      palavrasChave: ['notebook'],
    }, signal);

    const [criterio] = repo.salvar.mock.calls[0]!;
    expect(criterio.tenantId).toBe(TENANT_A);
    expect(criterio.clienteFinalId).toBe(CLIENTE_A);
  });

  it('TRIAGEM escrever: TriarEditalUseCase nega perfil de outro cliente antes de LLM/persistência', async () => {
    const llm = { extrair: vi.fn().mockResolvedValue(extracao()) };
    const triagens = { salvar: vi.fn(), porEditalEPerfil: vi.fn() };
    const uc = new TriarEditalUseCase(
      { porEdital: vi.fn().mockResolvedValue(null), salvar: vi.fn() },
      { porId: vi.fn().mockResolvedValue(perfilTriagem(CLIENTE_B)) },
      llm,
      triagens,
      { publicar: vi.fn() },
    );

    await expect(uc.executar({
      editalId: EDITAL,
      perfilId: PERFIL,
      clienteFinalId: CLIENTE_A,
      tenantId: TENANT_A,
      conteudo: { editalId: EDITAL, texto: 'edital', temTextoSelecionavel: true, anexos: [], paginas: 1 },
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(llm.extrair).not.toHaveBeenCalled();
    expect(triagens.salvar).not.toHaveBeenCalled();
  });

  it('TRIAGEM disparar: SolicitarTriagemUseCase nega perfil de outro cliente e não enfileira', async () => {
    const eventos = { publicar: vi.fn() };
    const triagens = { salvar: vi.fn(), porEditalEPerfil: vi.fn().mockResolvedValue(null) };
    const uc = new SolicitarTriagemUseCase(
      { porId: vi.fn().mockResolvedValue(perfilTriagem(CLIENTE_B)) },
      triagens,
      eventos,
    );

    await expect(uc.executar({
      editalId: EDITAL,
      perfilId: PERFIL,
      clienteFinalId: CLIENTE_A,
      tenantId: TENANT_A,
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(triagens.salvar).not.toHaveBeenCalled();
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('TRIAGEM ler: ConsultarTriagemUseCase recheca objeto retornado e nega tenant/cliente cruzado', async () => {
    const extracoes = { porEdital: vi.fn().mockResolvedValue(extracao()), salvar: vi.fn() };
    const uc = new ConsultarTriagemUseCase(
      { porEditalEPerfil: vi.fn().mockResolvedValue(Triagem.pendente(EDITAL, PERFIL, TENANT_B, CLIENTE_B)), salvar: vi.fn() },
      extracoes,
    );

    await expect(uc.executar({
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      editalId: EDITAL,
      perfilId: PERFIL,
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(extracoes.porEdital).not.toHaveBeenCalled();
  });

  it('TRIAGEM feedback/decisão: RegistrarFeedbackTriagemUseCase nega objeto de outro tenant', async () => {
    const eventos = { publicar: vi.fn() };
    const uc = new RegistrarFeedbackTriagemUseCase(
      { porEditalEPerfil: vi.fn().mockResolvedValue(Triagem.pendente(EDITAL, PERFIL, TENANT_B, CLIENTE_B)), salvar: vi.fn() },
      eventos,
    );

    await expect(uc.executar({
      tipo: 'decisao',
      go: true,
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      editalId: EDITAL,
      perfilId: PERFIL,
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('ALERTA escrever: RegistrarFeedbackAlertaUseCase nega alerta de outro cliente e não muta', async () => {
    const repo = {
      salvar: vi.fn(),
      salvarEmLote: vi.fn(),
      porId: vi.fn().mockResolvedValue(alerta(CLIENTE_B)),
      atualizarFeedback: vi.fn(),
      listarPorTenant: vi.fn(),
    };
    const uc = new RegistrarFeedbackAlertaUseCase(repo, { publicar: vi.fn() });

    await expect(uc.executar({ alertaId: ALERTA, relevante: true, clienteFinalId: CLIENTE_A }, signal))
      .rejects.toThrow(AcessoNegadoError);
    expect(repo.atualizarFeedback).not.toHaveBeenCalled();
  });

  it('PREFERENCIA_NOTIFICACAO escrever: DefinirPreferenciasNotificacaoUseCase nega usuário diferente', async () => {
    const repo = { salvar: vi.fn(), porUsuario: vi.fn() };
    const uc = new DefinirPreferenciasNotificacaoUseCase(repo);

    await expect(uc.executar({
      usuarioId: UsuarioId('usuario-a'),
      chamadorId: UsuarioId('usuario-b'),
      canais: ['EMAIL'],
      frequencia: 'DIARIA',
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(repo.salvar).not.toHaveBeenCalled();
  });

  it('PERFIL_HABILITACAO ler: ConsultarPerfilHabilitacaoUseCase nega perfil retornado de outro escopo', async () => {
    const uc = new ConsultarPerfilHabilitacaoUseCase({
      porClienteFinal: vi.fn().mockResolvedValue(perfilIdentidade(TENANT_B, CLIENTE_B)),
      salvar: vi.fn(),
    });

    await expect(uc.executar({ tenantId: TENANT_A, clienteFinalId: CLIENTE_A }, signal))
      .rejects.toThrow(AcessoNegadoError);
  });

  it('PERFIL_HABILITACAO escrever: GerenciarPerfilHabilitacaoUseCase nega perfil existente de outro tenant', async () => {
    const repo = {
      porClienteFinal: vi.fn().mockResolvedValue(perfilIdentidade(TENANT_B, CLIENTE_A)),
      salvar: vi.fn(),
    };
    const eventos = { publicar: vi.fn() };
    const uc = new GerenciarPerfilHabilitacaoUseCase(repo, { gerar: vi.fn().mockReturnValue(PERFIL) }, eventos);

    await expect(uc.executar({
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      habJuridica: [],
      habFiscal: [],
      habTecnica: ['ISO-9001'],
      habEconomica: [],
    }, signal)).rejects.toThrow(AcessoNegadoError);
    expect(repo.salvar).not.toHaveBeenCalled();
    expect(eventos.publicar).not.toHaveBeenCalled();
  });
});

describe('Gate A07 · AB10 — solicitação de titular', () => {
  function uc(verificarTitular: ReturnType<typeof vi.fn>, registrar = vi.fn().mockResolvedValue(undefined)) {
    return new AtenderSolicitacaoTitularUseCase(
      { salvar: vi.fn().mockResolvedValue(undefined), porId: vi.fn().mockResolvedValue(null) },
      { verificarTitular },
      { registrar },
      { gerar: vi.fn().mockReturnValue(SolicitacaoId('sol-1')) },
      { gerar: vi.fn().mockReturnValue(AuditLogId('audit-1')) },
      { agora: () => new Date('2026-07-10T00:00:00Z') },
    );
  }

  it('nega pedido de titular não verificado antes de qualquer consulta de dados', async () => {
    await expect(uc(vi.fn().mockResolvedValue({ verificada: false })).executar({
      tipo: 'acesso',
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      titularRef: 'titular-ref-hash',
      operadorId: 'dpo',
    }, signal)).rejects.toThrow(IdentidadeNaoVerificadaError);
  });

  it('nega titular verificado mas sem vínculo com o clienteFinal do escopo', async () => {
    await expect(uc(vi.fn().mockResolvedValue({ verificada: true, vinculadoAoEscopo: false })).executar({
      tipo: 'acesso',
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      titularRef: 'titular-ref-hash',
      operadorId: 'dpo',
    }, signal)).rejects.toThrow(AcessoNegadoError);
  });
});

describe('Gate A07 · AB13 — auditoria fail-closed e append-only lógico', () => {
  class AppendOnlyAuditLog {
    readonly registros: RegistroAuditoria[] = [];

    async registrar(registro: RegistroAuditoria): Promise<void> {
      this.registros.push(registro);
    }

    async atualizar(): Promise<never> {
      throw new Error('AUDIT_LOG_APPEND_ONLY');
    }

    async remover(): Promise<never> {
      throw new Error('AUDIT_LOG_APPEND_ONLY');
    }
  }

  it('RegistrarAuditoriaUseCase só acrescenta registros e não expõe caminho de mutação', async () => {
    const auditLog = new AppendOnlyAuditLog();
    const uc = new RegistrarAuditoriaUseCase(
      auditLog,
      { gerar: vi.fn().mockReturnValue(AuditLogId('audit-1')) },
      { agora: () => new Date('2026-07-10T00:00:00Z') },
    );

    await uc.executar({
      usuarioId: 'usuario-a',
      recurso: 'triagem:edital-a',
      acao: 'LER',
      baseLegal: 'LGPD art. 7 II',
      escopo: { tenantId: TENANT_A, clienteFinalId: CLIENTE_A },
    }, signal);

    expect(auditLog.registros).toHaveLength(1);
    await expect(auditLog.atualizar()).rejects.toThrow('AUDIT_LOG_APPEND_ONLY');
    await expect(auditLog.remover()).rejects.toThrow('AUDIT_LOG_APPEND_ONLY');
  });

  it('falha fechada quando a trilha de auditoria não grava', async () => {
    const uc = new RegistrarAuditoriaUseCase(
      { registrar: vi.fn().mockRejectedValue(new Error('db down')) },
      { gerar: vi.fn().mockReturnValue(AuditLogId('audit-1')) },
      { agora: () => new Date('2026-07-10T00:00:00Z') },
    );

    await expect(uc.executar({
      usuarioId: 'usuario-a',
      recurso: 'triagem:edital-a',
      acao: 'LER',
      baseLegal: 'LGPD art. 7 II',
      escopo: { tenantId: TENANT_A, clienteFinalId: CLIENTE_A },
    }, signal)).rejects.toThrow(AuditoriaIndisponivelError);
  });
});

describe('Gate A07 · AB13 — CRITERIO_MONITORAMENTO auditoria fail-closed (docs/05 §9, P-61)', () => {
  const repoBase = () => ({
    salvar: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    listarAtivos: vi.fn(),
    listarPorTenant: vi.fn().mockResolvedValue([]),
  });

  it('DefinirCriterioMonitoramentoUseCase bloqueia operação e não publica evento quando auditoria falha', async () => {
    const repo = repoBase();
    const publicar = vi.fn();
    const uc = new DefinirCriterioMonitoramentoUseCase(
      repo,
      { faixasVigentes: vi.fn().mockResolvedValue([]) },
      { publicar },
      { gerar: vi.fn().mockReturnValue(CRITERIO) },
      { agora: () => new Date('2026-07-10T00:00:00Z') },
      { registrar: vi.fn().mockRejectedValue(new Error('db down')) },
    );

    await expect(uc.executar({
      tenantId: TENANT_A,
      clienteFinalId: CLIENTE_A,
      palavrasChave: ['notebook'],
    }, signal)).rejects.toThrow(AuditoriaIndisponivelError);

    expect(publicar).not.toHaveBeenCalled();
  });

  it('ConsultarCriteriosTenantUseCase bloqueia leitura quando auditoria falha', async () => {
    const repo = repoBase();
    const uc = new ConsultarCriteriosTenantUseCase(
      repo,
      { registrar: vi.fn().mockRejectedValue(new Error('db down')) },
    );

    await expect(uc.executar({ tenantId: TENANT_A }, signal)).rejects.toThrow(AuditoriaIndisponivelError);
    expect(repo.listarPorTenant).not.toHaveBeenCalled();
  });

  it('ConsultarCriteriosTenantUseCase registra ação LER no escopo correto', async () => {
    const registrar = vi.fn().mockResolvedValue(undefined);
    const uc = new ConsultarCriteriosTenantUseCase(
      repoBase(),
      { registrar },
    );

    await uc.executar({ tenantId: TENANT_A }, signal);

    expect(registrar).toHaveBeenCalledOnce();
    const [entrada] = registrar.mock.calls[0]!;
    expect(entrada.acao).toBe('LER');
    expect(entrada.escopo.tenantId).toBe(TENANT_A);
  });
});

describe('Gate A07 · AB14 — trust-gating de anexos', () => {
  it('download de anexo sempre entra como pendente/quarentenado antes de consumo', async () => {
    const anexoRepo = { listarPorEdital: vi.fn().mockResolvedValue([]), salvar: vi.fn(), atualizarEstado: vi.fn() };
    const eventos = { publicar: vi.fn() };
    const uc = new BaixarAnexosEditalUseCase(
      {
        buscarArquivos: vi.fn().mockResolvedValue([{ nome: 'edital.pdf', urlOrigem: 'https://pncp.gov.br/a.pdf', tamanhoBytes: 10, tipoMime: 'application/pdf' }]),
        downloadArquivo: vi.fn().mockResolvedValue(new Uint8Array([1])),
        buscarContratacoesPorPublicacao: vi.fn(),
        buscarContratacoesPorAtualizacao: vi.fn(),
        buscarContratacaoPorNumero: vi.fn(),
      },
      {
        porId: vi.fn().mockResolvedValue(edital()),
        porNumeroControle: vi.fn(),
        upsertPorNumeroControle: vi.fn(),
        listarPorJanelaPublicacao: vi.fn(),
      },
      { armazenar: vi.fn().mockResolvedValue('landing/edital.pdf'), obter: vi.fn(), deletar: vi.fn() },
      anexoRepo,
      eventos,
    );

    await uc.executar({ editalId: EDITAL }, signal);

    const [, anexos] = anexoRepo.salvar.mock.calls[0] as [EditalId, Array<{ estadoConfianca: string }>];
    expect(anexos[0]!.estadoConfianca).toBe('pendente');
    expect(eventos.publicar.mock.calls[0]![0]).toBeInstanceOf(AnexoQuarentenado);
  });

  it('scanner usa storageKey do domínio, não storageKey adulterado no evento', async () => {
    const scanner = { escanear: vi.fn().mockResolvedValue('limpo' as const) };
    const repo = {
      listarPorEdital: vi.fn().mockResolvedValue([{
        nome: 'edital.pdf',
        storageKey: 'landing/tenant-a/edital.pdf',
        tamanhoBytes: 10,
        tipoMime: 'application/pdf',
        estadoConfianca: 'pendente' as const,
      }]),
      salvar: vi.fn(),
      atualizarEstado: vi.fn(),
    };
    const eventos = { publicar: vi.fn() };
    const uc = new EscanearAnexoUseCase(scanner, repo, eventos);

    await uc.executar({
      editalId: EDITAL,
      nomeAnexo: 'edital.pdf',
      storageKey: 'landing/tenant-b/segredo.pdf',
    }, signal);

    expect(scanner.escanear).toHaveBeenCalledWith('landing/tenant-a/edital.pdf', signal);
    expect(eventos.publicar.mock.calls[0]![0]).toBeInstanceOf(AnexoAprovado);
  });
});

describe('Gate A07 · AB2 — RBAC por papel (P-52, docs/05 §4, RAD-212)', () => {
  const USUARIO_OPERADOR = UsuarioIdIdentidade('usuario-operador');
  const USUARIO_ADMIN = UsuarioIdIdentidade('usuario-admin');

  function permissaoRepositoryFake(atribuicoes: readonly AtribuicaoPapel[]): PermissaoRepository {
    const mapa = new Map(atribuicoes.map((a) => [a.usuarioId as string, a]));
    return {
      async buscarPorUsuario(usuarioId, opts) {
        opts.signal.throwIfAborted();
        return mapa.get(usuarioId) ?? null;
      },
    };
  }

  it('operador não vira admin: matriz nega USUARIO_PAPEL/gerenciar a OPERADOR e permite a ADMIN_CONSULTORIA', () => {
    expect(podeExecutar('OPERADOR', 'USUARIO_PAPEL', 'gerenciar')).toBe(false);
    expect(podeExecutar('ADMIN_CONSULTORIA', 'USUARIO_PAPEL', 'gerenciar')).toBe(true);
  });

  it('read-only não escreve: AutorizarAcessoUseCase nega CLIENTE_FINAL_READONLY em CRITERIO_MONITORAMENTO/criar', async () => {
    const uc = new AutorizarAcessoUseCase();
    const contexto = {
      usuarioId: UsuarioIdIdentidade('usuario-readonly'),
      tenantId: TENANT_A,
      papel: 'CLIENTE_FINAL_READONLY' as const,
      clienteFinalIds: [CLIENTE_A],
    };

    await expect(
      uc.executar({ contexto, recurso: 'CRITERIO_MONITORAMENTO', acao: 'criar' }, signal),
    ).rejects.toThrow(AcessoNegadoError);
  });

  it('token válido sem papel nega: ResolverContextoAutorizacaoUseCase sem atribuição no PermissaoRepository', async () => {
    const permissoes = permissaoRepositoryFake([]);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    await expect(
      uc.executar({ usuarioId: USUARIO_OPERADOR, tenantId: TENANT_A }, signal),
    ).rejects.toThrow(AcessoNegadoError);
  });

  it('token de tenant divergente nega: atribuição de outro tenant não vale para o claim verificado', async () => {
    const atribuicaoOutroTenant = AtribuicaoPapel.criar({
      usuarioId: USUARIO_OPERADOR,
      tenantId: TENANT_B,
      papel: 'OPERADOR',
      clienteFinalIds: [CLIENTE_A],
    });
    const permissoes = permissaoRepositoryFake([atribuicaoOutroTenant]);
    const uc = new ResolverContextoAutorizacaoUseCase(permissoes);

    await expect(
      uc.executar({ usuarioId: USUARIO_OPERADOR, tenantId: TENANT_A }, signal),
    ).rejects.toThrow(AcessoNegadoError);
  });

  it('papel em um clienteFinalId não alcança outro: OPERADOR nega fora do escopo, ADMIN_CONSULTORIA atravessa o tenant', async () => {
    const uc = new AutorizarAcessoUseCase();

    await expect(
      uc.executar(
        {
          contexto: { usuarioId: USUARIO_OPERADOR, tenantId: TENANT_A, papel: 'OPERADOR', clienteFinalIds: [CLIENTE_A] },
          recurso: 'TRIAGEM',
          acao: 'ler',
          clienteFinalId: CLIENTE_B,
        },
        signal,
      ),
    ).rejects.toThrow(AcessoNegadoError);

    await expect(
      uc.executar(
        {
          contexto: { usuarioId: USUARIO_ADMIN, tenantId: TENANT_A, papel: 'ADMIN_CONSULTORIA', clienteFinalIds: [CLIENTE_A] },
          recurso: 'TRIAGEM',
          acao: 'ler',
          clienteFinalId: CLIENTE_B,
        },
        signal,
      ),
    ).resolves.toBeUndefined();
  });

  it('AUDIT_LOG e SOLICITACAO_TITULAR restritos a DPO_COMPLIANCE/ADMIN_CONSULTORIA — OPERADOR e CLIENTE_FINAL_READONLY negados', () => {
    expect(podeExecutar('DPO_COMPLIANCE', 'AUDIT_LOG', 'ler')).toBe(true);
    expect(podeExecutar('ADMIN_CONSULTORIA', 'AUDIT_LOG', 'ler')).toBe(true);
    expect(podeExecutar('OPERADOR', 'AUDIT_LOG', 'ler')).toBe(false);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'AUDIT_LOG', 'ler')).toBe(false);

    expect(podeExecutar('DPO_COMPLIANCE', 'SOLICITACAO_TITULAR', 'decidir')).toBe(true);
    expect(podeExecutar('OPERADOR', 'SOLICITACAO_TITULAR', 'decidir')).toBe(false);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'SOLICITACAO_TITULAR', 'decidir')).toBe(false);
  });
});
