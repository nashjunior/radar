import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { TriarEditalUseCase } from '../../application/use-cases/triar-edital.js';
import type { TriarEditalInput } from '../../application/use-cases/triar-edital.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../../application/politica-confianca.js';
import { MAX_INPUT_TOKENS_ADMISSAO, POLITICA_ORCAMENTO_PADRAO } from '../../application/politica-orcamento.js';
import type { PoliticaOrcamento } from '../../application/politica-orcamento.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import type {
  EstimativaDeCusto,
  EventPublisher,
  ExtracaoRepository,
  LlmGateway,
  PerfilGateway,
  TriagemRepository,
  UsoLlm,
  UsoLlmLedger,
} from '../../application/ports.js';
import {
  ConfiancaInsuficienteError,
  EntradaExcedeTetoDeAdmissaoError,
  ExtracaoRecusadaError,
  OrcamentoDeCustoExcedidoError,
  PerfilNaoEncontradoError,
  SaidaLlmInvalidaError,
} from '../../domain/errors/index.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';

const noop = new AbortController().signal;
const EDITAL = EditalId('edital-1');
const PERFIL = PerfilId('perfil-1');
const CLIENTE = ClienteFinalId('cliente-1');
const TENANT = TenantId('global');

function extracao(confObjeto = 0.9): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: CampoExtraido.criar({
      valor: 'Aquisição de notebooks',
      confianca: Confianca.criar(confObjeto),
      citacao: Citacao.criar(1, 'objeto'),
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar<number | null>({
      valor: 250000,
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(2, 'valor'),
      critico: true,
    }),
    dataAberturaPropostas: CampoExtraido.criar<Date | null>({
      valor: null,
      confianca: Confianca.criar(0.5),
      citacao: null,
      critico: false,
    }),
    requisitos: [
      Requisito.criar('fiscal', 'Certidão CND', null), // atendido pelo perfil
      Requisito.criar('tecnica', 'Registro CREA', null), // lacuna → risco
    ],
    riscosBrutos: [],
    paginas: 5,
  });
}

const CONTEUDO: EntradaExtracaoDTO = {
  editalId: EDITAL,
  texto: 'edital',
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 5,
};

const INPUT: TriarEditalInput = {
  editalId: EDITAL,
  perfilId: PERFIL,
  clienteFinalId: CLIENTE,
  tenantId: TENANT,
  conteudo: CONTEUDO,
  limiarConfianca: 0.5,
};

const USO_FAKE: UsoLlm = {
  modelo: 'claude-sonnet-5',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const PERFIL_HAB = PerfilHabilitacao.de({
  id: PERFIL,
  clienteFinalId: CLIENTE,
  habJuridica: [],
  habFiscal: ['CND'],
  habTecnica: [],
  habEconomica: [],
});

const ESTIMATIVA_BARATA: EstimativaDeCusto = {
  modelo: 'claude-sonnet-5',
  inputTokens: 1000,
  custoEstimadoUsd: 0.01,
};

function deps(opts: {
  existente?: ExtracaoEdital | null;
  extraida?: ExtracaoEdital;
  perfil?: PerfilHabilitacao | null;
  estimativa?: EstimativaDeCusto;
  gastoGlobalUsd?: number;
  gastoTenantUsd?: number;
  orcamento?: PoliticaOrcamento;
}) {
  const porEdital = vi.fn().mockResolvedValue(opts.existente ?? null);
  const salvarExtracao = vi.fn().mockResolvedValue(undefined);
  const extrair = vi.fn().mockResolvedValue({ extracao: opts.extraida ?? extracao(), uso: USO_FAKE });
  const estimarCusto = vi.fn().mockResolvedValue(opts.estimativa ?? ESTIMATIVA_BARATA);
  const porId = vi.fn().mockResolvedValue(opts.perfil === undefined ? PERFIL_HAB : opts.perfil);
  const salvarTriagem = vi.fn().mockResolvedValue(undefined);
  const publicar = vi.fn().mockResolvedValue(undefined);
  const registrar = vi.fn().mockResolvedValue(undefined);
  const gastoUsdNaJanela = vi.fn().mockImplementation((escopo: { tenantId: unknown }) =>
    Promise.resolve(escopo.tenantId === null ? (opts.gastoGlobalUsd ?? 0) : (opts.gastoTenantUsd ?? 0)),
  );

  const extracoes: ExtracaoRepository = { porEdital, salvar: salvarExtracao };
  const perfis: PerfilGateway = { porId };
  const llm: LlmGateway = { extrair, estimarCusto };
  const triagens: TriagemRepository = { salvar: salvarTriagem, porEditalEPerfil: vi.fn() };
  const eventos: EventPublisher = { publicar };
  const usoLedger: UsoLlmLedger = { registrar, gastoUsdNaJanela };

  const uc = new TriarEditalUseCase(
    extracoes,
    perfis,
    llm,
    triagens,
    eventos,
    usoLedger,
    opts.orcamento ?? POLITICA_ORCAMENTO_PADRAO,
  );
  return {
    uc,
    porEdital,
    salvarExtracao,
    extrair,
    estimarCusto,
    porId,
    salvarTriagem,
    publicar,
    registrar,
    gastoUsdNaJanela,
    llm,
  };
}

describe('TriarEditalUseCase', () => {
  it('cache-miss: chama o LLM, salva a extração e conclui a triagem (publica triagem.concluida)', async () => {
    const { uc, extrair, salvarExtracao, salvarTriagem, publicar, registrar } = deps({ existente: null });
    const dto = await uc.executar(INPUT, noop);

    expect(extrair).toHaveBeenCalledWith(CONTEUDO, noop);
    expect(salvarExtracao).toHaveBeenCalledTimes(1);
    expect(salvarTriagem).toHaveBeenCalledTimes(1);
    expect(dto.aderencia).toBeCloseTo(0.5);
    expect(dto.recomendacao).toBe('no-go');
    expect(dto.riscos.map((r) => r.descricao)).toEqual(['não atende: Registro CREA']);

    const [evento] = publicar.mock.calls[0]!;
    expect(evento.type).toBe('triagem.concluida');
    expect(evento.payload.riscos).toEqual(['não atende: Registro CREA']); // string[] no evento
    expect(evento.payload.clienteFinalId).toBe(CLIENTE);

    // RAD-230: único caller com tenant/perfil conhecidos no momento da chamada ao LLM.
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar.mock.calls[0]![0]).toMatchObject({
      editalId: EDITAL,
      tenantId: TENANT,
      clienteFinalId: CLIENTE,
      perfilId: PERFIL,
      modelo: USO_FAKE.modelo,
    });
  });

  it('cache-hit por edital (P-45): NÃO chama o LLM', async () => {
    const { uc, extrair, salvarExtracao } = deps({ existente: extracao() });
    await uc.executar(INPUT, noop);
    expect(extrair).not.toHaveBeenCalled();
    expect(salvarExtracao).not.toHaveBeenCalled();
  });

  it('gate de confiança: abaixo do limiar → ConfiancaInsuficienteError, persiste incompleta e não publica (RAD-79)', async () => {
    const { uc, porId, salvarTriagem, publicar } = deps({ existente: extracao(0.4) });
    await expect(uc.executar({ ...INPUT, limiarConfianca: 0.7 }, noop)).rejects.toThrow(
      ConfiancaInsuficienteError,
    );
    expect(porId).toHaveBeenCalled();
    // RAD-79: persiste status 'incompleta' antes de re-lançar para que leitores vejam o estado
    expect(salvarTriagem).toHaveBeenCalledOnce();
    expect(salvarTriagem.mock.calls[0]![0].status).toBe('incompleta');
    expect(publicar).not.toHaveBeenCalled();
  });

  it('P-19: sem limiarConfianca explícito, o gate aplica LIMIAR_CONFIANCA_PADRAO (fonte única)', async () => {
    // A composição-root pode omitir o limiar; o use case cai no default de lançamento (P-19),
    // e não num literal mágico. Confiança agregada = MÍN dos críticos (objeto vs. valorEstimado 0.9).
    const eps = 0.05;
    const INPUT_SEM_LIMIAR: TriarEditalInput = {
      editalId: EDITAL,
      perfilId: PERFIL,
      clienteFinalId: CLIENTE,
      tenantId: TENANT,
      conteudo: CONTEUDO,
    }; // sem limiarConfianca (agora opcional)

    // logo ABAIXO do default → degrada para leitura assistida (incompleta), não publica
    const abaixo = deps({ existente: extracao(LIMIAR_CONFIANCA_PADRAO - eps) });
    await expect(abaixo.uc.executar(INPUT_SEM_LIMIAR, noop)).rejects.toThrow(ConfiancaInsuficienteError);
    expect(abaixo.salvarTriagem.mock.calls[0]![0].status).toBe('incompleta');
    expect(abaixo.publicar).not.toHaveBeenCalled();

    // logo ACIMA do default → conclui e publica triagem.concluida
    const acima = deps({ existente: extracao(LIMIAR_CONFIANCA_PADRAO + eps) });
    await acima.uc.executar(INPUT_SEM_LIMIAR, noop);
    expect(acima.publicar).toHaveBeenCalledOnce();
    expect(acima.publicar.mock.calls[0]![0].type).toBe('triagem.concluida');
  });

  it('fila envenenada: perfil de OUTRO cliente NÃO dispara a extração PAGA (authz antes da extração)', async () => {
    // Cache-miss (`existente: null`): na ordem antiga o `llm.extrair` PAGO rodaria antes do authz.
    // Com o authz por objeto à frente, a chamada paga fica fechada atrás dele — protege contra fila
    // envenenada (RAD-56 #3 / fronteira AB9-cost-DoS).
    const { uc, extrair, salvarExtracao, salvarTriagem } = deps({
      existente: null,
      perfil: PerfilHabilitacao.de({
        id: PERFIL,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: ['CND'],
        habTecnica: [],
        habEconomica: [],
      }),
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
    expect(extrair).not.toHaveBeenCalled(); // a extração paga nunca dispara para um perfil não autorizado
    expect(salvarExtracao).not.toHaveBeenCalled();
    expect(salvarTriagem).not.toHaveBeenCalled();
  });

  it('perfil inexistente → PerfilNaoEncontradoError (erro de orquestração, 404)', async () => {
    const { uc, salvarTriagem } = deps({ existente: extracao(), perfil: null });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(PerfilNaoEncontradoError);
    expect(salvarTriagem).not.toHaveBeenCalled();
  });

  it('perfil de OUTRO cliente → AcessoNegadoError (authz por objeto, defesa em profundidade)', async () => {
    const { uc, salvarTriagem, publicar } = deps({
      existente: extracao(),
      perfil: PerfilHabilitacao.de({
        id: PERFIL,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: ['CND'],
        habTecnica: [],
        habEconomica: [],
      }),
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
    expect(salvarTriagem).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });
});

describe('TriarEditalUseCase — admission control + orçamento (RAD-243)', () => {
  it('authz roda ANTES do admission control (fila envenenada não paga nem o count_tokens)', async () => {
    const { uc, extrair, estimarCusto } = deps({
      existente: null,
      perfil: PerfilHabilitacao.de({
        id: PERFIL,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: ['CND'],
        habTecnica: [],
        habEconomica: [],
      }),
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
    expect(estimarCusto).not.toHaveBeenCalled();
    expect(extrair).not.toHaveBeenCalled();
  });

  it('cache-hit não paga admission control (extração já existe, sem chamada ao LLM)', async () => {
    const { uc, estimarCusto } = deps({ existente: extracao() });
    await uc.executar(INPUT, noop);
    expect(estimarCusto).not.toHaveBeenCalled();
  });

  it('entrada excede o teto de admissão → EntradaExcedeTetoDeAdmissaoError, sem chamar o LLM', async () => {
    const { uc, extrair } = deps({
      existente: null,
      estimativa: { modelo: 'claude-opus-4-8', inputTokens: MAX_INPUT_TOKENS_ADMISSAO + 1, custoEstimadoUsd: 5 },
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(EntradaExcedeTetoDeAdmissaoError);
    expect(extrair).not.toHaveBeenCalled();
  });

  it('orçamento GLOBAL excedido → OrcamentoDeCustoExcedidoError, sem chamar o LLM', async () => {
    const orcamento: PoliticaOrcamento = { janelaHoras: 24, orcamentoGlobalUsd: 10, orcamentoPorTenantUsd: null };
    const { uc, extrair } = deps({
      existente: null,
      estimativa: { modelo: 'claude-sonnet-5', inputTokens: 1000, custoEstimadoUsd: 0.5 },
      gastoGlobalUsd: 9.6,
      orcamento,
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(OrcamentoDeCustoExcedidoError);
    expect(extrair).not.toHaveBeenCalled();
  });

  it('orçamento POR TENANT excedido (mesmo com o global sobrando) → OrcamentoDeCustoExcedidoError', async () => {
    const orcamento: PoliticaOrcamento = {
      janelaHoras: 24,
      orcamentoGlobalUsd: 1000, // global folgado
      orcamentoPorTenantUsd: 1, // tenant apertado
    };
    const { uc, extrair, gastoUsdNaJanela } = deps({
      existente: null,
      estimativa: { modelo: 'claude-sonnet-5', inputTokens: 1000, custoEstimadoUsd: 0.5 },
      gastoGlobalUsd: 0,
      gastoTenantUsd: 0.6,
      orcamento,
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(OrcamentoDeCustoExcedidoError);
    expect(extrair).not.toHaveBeenCalled();
    expect(gastoUsdNaJanela).toHaveBeenCalledWith({ tenantId: null }, expect.any(Date), noop);
    expect(gastoUsdNaJanela).toHaveBeenCalledWith({ tenantId: TENANT }, expect.any(Date), noop);
  });

  it('orcamentoPorTenantUsd: null (default) — não checa orçamento por tenant, só o global', async () => {
    const { uc, gastoUsdNaJanela } = deps({ existente: null }); // POLITICA_ORCAMENTO_PADRAO: orcamentoPorTenantUsd null
    await uc.executar(INPUT, noop);
    expect(gastoUsdNaJanela).toHaveBeenCalledTimes(1); // só a checagem global
  });

  it('GAP fechado: recusa do modelo (usoParcial) registra o custo e degrada a triagem para "recusada"', async () => {
    const { uc, extrair, registrar, salvarTriagem } = deps({ existente: null });
    extrair.mockRejectedValue(new ExtracaoRecusadaError(USO_FAKE));

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(ExtracaoRecusadaError);

    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar.mock.calls[0]![0]).toMatchObject({
      editalId: EDITAL,
      tenantId: TENANT,
      clienteFinalId: CLIENTE,
      perfilId: PERFIL,
      modelo: USO_FAKE.modelo,
    });
    expect(salvarTriagem.mock.calls[0]![0].status).toBe('recusada');
  });

  it('GAP fechado: truncamento (SaidaLlmInvalidaError com usoParcial) registra o custo antes de propagar', async () => {
    const { uc, extrair, registrar } = deps({ existente: null });
    extrair.mockRejectedValue(new SaidaLlmInvalidaError('resposta truncada (max_tokens)', USO_FAKE));

    await expect(uc.executar(INPUT, noop)).rejects.toThrow(SaidaLlmInvalidaError);
    expect(registrar).toHaveBeenCalledTimes(1);
  });
});
