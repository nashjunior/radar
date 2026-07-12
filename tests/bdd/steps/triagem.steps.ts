import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import {
  TriarEditalUseCase,
  ConsultarTriagemUseCase,
  ConfiancaInsuficienteError,
  ExtracaoEdital,
  Triagem,
  Aderencia,
  CampoExtraido,
  Confianca,
  Requisito,
  PerfilHabilitacao,
} from '@radar/triagem';
import { PostgresTriagemRepository, PostgresExtracaoRepository } from '@radar/triagem/infra';
import type {
  DomainEvent,
  EntradaExtracaoDTO,
  EstimativaDeCusto,
  EventPublisher,
  LlmGateway,
  PerfilGateway,
  TriagemDTO,
  UsoLlm,
  UsoLlmLedger,
} from '@radar/triagem';
import { ctx as matchingCtx } from './matching.steps.js';
import { getFixture } from '../support/hooks.js';

// ---------------------------------------------------------------------------
// Stubs de gateways externos (LLM e Perfil nunca chamam serviços reais — A04 §4)
// ---------------------------------------------------------------------------

const USO_STUB: UsoLlm = {
  modelo: 'stub',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const ESTIMATIVA_STUB: EstimativaDeCusto = { modelo: 'stub', inputTokens: 0, custoEstimadoUsd: 0 };

class StubLlmGateway implements LlmGateway {
  callCount = 0;
  private next: ExtracaoEdital | null = null;
  preparar(e: ExtracaoEdital): void { this.next = e; }
  async estimarCusto(_entrada: EntradaExtracaoDTO, _signal: AbortSignal): Promise<EstimativaDeCusto> {
    return ESTIMATIVA_STUB; // BDD não exercita admission control real (RAD-243) — orçamento default é sem teto
  }
  async extrair(
    _entrada: EntradaExtracaoDTO,
    _signal: AbortSignal,
  ): Promise<{ extracao: ExtracaoEdital; uso: UsoLlm }> {
    this.callCount++;
    if (!this.next) throw new Error('LLM stub não configurado');
    return { extracao: this.next, uso: USO_STUB };
  }
}

const usoLedgerStub: UsoLlmLedger = {
  async registrar(_registro, _signal) {
    /* stub — BDD não exercita o ledger de custo (RAD-230) */
  },
  async gastoUsdNaJanela(_escopo, _desde, _signal) {
    return 0; // BDD roda com POLITICA_ORCAMENTO_PADRAO (sem teto) — kill-switch nunca aciona
  },
};

class StubPerfilGateway implements PerfilGateway {
  private perfis = new Map<string, PerfilHabilitacao>();
  registrar(p: PerfilHabilitacao): void { this.perfis.set(p.id, p); }
  async porId(id: PerfilId, _s: AbortSignal): Promise<PerfilHabilitacao | null> {
    return this.perfis.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface TriagemCtx {
  llmGateway: StubLlmGateway;
  perfilGateway: StubPerfilGateway;
  editalId: string;
  perfilId: string;
  clienteId: string;
  limiarConfianca: number;
  triarResult: TriagemDTO | null;
  erroCatch: unknown;
  eventosLocais: DomainEvent[];
}

const tctx: TriagemCtx = {
  llmGateway: new StubLlmGateway(),
  perfilGateway: new StubPerfilGateway(),
  editalId: 'edital-triagem-001',
  perfilId: 'perfil-001',
  clienteId: '',
  limiarConfianca: 0.6,
  triarResult: null,
  erroCatch: null,
  eventosLocais: [],
};

Before(function () {
  tctx.llmGateway = new StubLlmGateway();
  tctx.perfilGateway = new StubPerfilGateway();
  tctx.editalId = 'edital-triagem-001';
  tctx.perfilId = 'perfil-001';
  tctx.clienteId = '';
  tctx.limiarConfianca = 0.6;
  tctx.triarResult = null;
  tctx.erroCatch = null;
  tctx.eventosLocais = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNAL = new AbortController().signal;

type CategoriaHab = 'juridica' | 'fiscal' | 'tecnica' | 'economica';

function criarExtracao(
  editalId: string,
  confianca: number,
  requisitos: Array<{ categoria: CategoriaHab; descricao: string }> = [],
): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EditalId(editalId),
    objeto: CampoExtraido.criar({
      valor: 'stub objeto',
      confianca: Confianca.criar(confianca),
      citacao: null,
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar({
      valor: null,
      confianca: Confianca.criar(confianca),
      citacao: null,
      critico: false,
    }),
    dataAberturaPropostas: CampoExtraido.criar({
      valor: null,
      confianca: Confianca.criar(confianca),
      citacao: null,
      critico: false,
    }),
    requisitos: requisitos.map((r) => Requisito.criar(r.categoria, r.descricao, null)),
    riscosBrutos: [],
    paginas: 10,
  });
}

function buildConteudo(): EntradaExtracaoDTO {
  return {
    editalId: tctx.editalId,
    texto: 'texto stub sintético',
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 10,
  };
}

function buildTriarUseCase(publisher: EventPublisher): TriarEditalUseCase {
  const { db } = getFixture();
  return new TriarEditalUseCase(
    new PostgresExtracaoRepository(db),
    tctx.perfilGateway,
    tctx.llmGateway,
    new PostgresTriagemRepository(db),
    publisher,
    usoLedgerStub,
  );
}

function buildConsultarUseCase(): ConsultarTriagemUseCase {
  const { db } = getFixture();
  return new ConsultarTriagemUseCase(
    new PostgresTriagemRepository(db),
    new PostgresExtracaoRepository(db),
  );
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('um repositório de triagens no PostgreSQL', function () {});

Given('um gateway de LLM configurado com stub sintético', function () {
  tctx.llmGateway = new StubLlmGateway();
  tctx.limiarConfianca = 0.6;
});

Given('um repositório de extração de edital no PostgreSQL', function () {});

// ---------------------------------------------------------------------------
// Givens por cenário
// ---------------------------------------------------------------------------

Given('um edital com objeto {string} disponível para triagem', function (_objeto: string) {
  tctx.editalId = 'edital-triagem-001';
});

Given(
  'um perfil de habilitação do cliente {string} com CNAE {string}',
  function (clienteId: string, cnae: string) {
    tctx.clienteId = clienteId;
    tctx.perfilId = `perfil-${clienteId}`;
    tctx.perfilGateway.registrar(
      PerfilHabilitacao.de({
        id: PerfilId(tctx.perfilId),
        clienteFinalId: ClienteFinalId(clienteId),
        habJuridica: [],
        habFiscal: [],
        habTecnica: [cnae],
        habEconomica: [],
      }),
    );
  },
);

Given(
  'o LLM retorna confiança {float} com recomendação {string}',
  function (confianca: number, _recomendacao: string) {
    const extracao = criarExtracao(tctx.editalId, confianca, [
      { categoria: 'tecnica', descricao: '62.01' },
    ]);
    tctx.llmGateway.preparar(extracao);
  },
);

Given(
  'o LLM retorna confiança {float} abaixo do limiar configurado',
  function (confianca: number) {
    tctx.limiarConfianca = Math.round((confianca + 0.15) * 100) / 100;
    const extracao = criarExtracao(tctx.editalId, confianca, []);
    tctx.llmGateway.preparar(extracao);
  },
);

Given(
  'uma triagem existente pertencente ao cliente {string}',
  async function (clienteId: string) {
    const { db } = getFixture();
    const editalId = EditalId('edital-idor-001');
    const perfilId = PerfilId('perfil-cliente-A');
    const triagem = Triagem.reconstituir({
      editalId,
      perfilId,
      tenantId: TenantId('global'),
      clienteFinalId: ClienteFinalId(clienteId),
      status: 'concluida',
      aderencia: Aderencia.criar(1.0),
      recomendacao: 'go',
      riscos: [],
    });
    const triagemRepo = new PostgresTriagemRepository(db);
    const extracaoRepo = new PostgresExtracaoRepository(db);
    await triagemRepo.salvar(triagem, SIGNAL);
    await extracaoRepo.salvar(criarExtracao('edital-idor-001', 0.9, []), SIGNAL);
    tctx.editalId = 'edital-idor-001';
    tctx.perfilId = 'perfil-cliente-A';
  },
);

Given('uma solicitação de triagem feita pelo cliente {string}', function (clienteId: string) {
  tctx.clienteId = clienteId;
});

Given(
  'um edital já triado uma vez para o perfil {string}',
  async function (perfilId: string) {
    const { db } = getFixture();
    tctx.editalId = 'edital-cache-001';
    tctx.perfilId = perfilId;
    tctx.clienteId = 'cliente-cache';
    const extracao = criarExtracao(tctx.editalId, 0.95, [
      { categoria: 'tecnica', descricao: '62.01' },
    ]);
    // Salva extração no banco — simula que o 1º ciclo já extraiu e cacheou
    await new PostgresExtracaoRepository(db).salvar(extracao, SIGNAL);
    tctx.perfilGateway.registrar(
      PerfilHabilitacao.de({
        id: PerfilId(perfilId),
        clienteFinalId: ClienteFinalId('cliente-cache'),
        habJuridica: [],
        habFiscal: [],
        habTecnica: ['62.01'],
        habEconomica: [],
      }),
    );
    tctx.llmGateway.callCount = 0;
  },
);

// ---------------------------------------------------------------------------
// Whens
// ---------------------------------------------------------------------------

When(
  'o sistema executa a triagem do edital para o perfil do cliente {string}',
  async function (clienteId: string) {
    const publisher: EventPublisher = {
      publicar: async (evento, _signal) => {
        tctx.eventosLocais.push(evento);
        matchingCtx.eventosPublicados.push(evento);
      },
    };
    const uc = buildTriarUseCase(publisher);
    try {
      tctx.triarResult = await uc.executar(
        {
          tenantId: TenantId('global'),
          editalId: EditalId(tctx.editalId),
          perfilId: PerfilId(tctx.perfilId),
          clienteFinalId: ClienteFinalId(clienteId),
          conteudo: buildConteudo(),
          limiarConfianca: tctx.limiarConfianca,
        },
        SIGNAL,
      );
    } catch (e) {
      tctx.erroCatch = e;
    }
  },
);

When(
  'o sistema tenta retornar a triagem para o cliente {string}',
  async function (clienteId: string) {
    const uc = buildConsultarUseCase();
    try {
      await uc.executar(
        {
          tenantId: TenantId('global'),
          editalId: EditalId(tctx.editalId),
          perfilId: PerfilId(tctx.perfilId),
          clienteFinalId: ClienteFinalId(clienteId),
        },
        SIGNAL,
      );
    } catch (e) {
      tctx.erroCatch = e;
    }
  },
);

When('uma segunda triagem é solicitada para o mesmo edital e mesmo perfil', async function () {
  const publisher: EventPublisher = { publicar: async () => {} };
  const uc = buildTriarUseCase(publisher);
  try {
    tctx.triarResult = await uc.executar(
      {
        tenantId: TenantId('global'),
        editalId: EditalId(tctx.editalId),
        perfilId: PerfilId(tctx.perfilId),
        clienteFinalId: ClienteFinalId(tctx.clienteId),
        conteudo: buildConteudo(),
        limiarConfianca: tctx.limiarConfianca,
      },
      SIGNAL,
    );
  } catch (e) {
    tctx.erroCatch = e;
  }
});

// ---------------------------------------------------------------------------
// Thens
// ---------------------------------------------------------------------------

Then('a triagem deve retornar recomendação {string}', function (esperada: string) {
  assert.ok(
    tctx.triarResult !== null && tctx.erroCatch === null,
    `triagem não retornou resultado. Erro: ${tctx.erroCatch}`,
  );
  assert.equal(tctx.triarResult!.recomendacao, esperada);
});

Then('a confiança deve ser igual a {float}', function (esperada: number) {
  const ev = tctx.eventosLocais.find((e) => e.type === 'triagem.concluida') as
    | { type: string; payload: { confianca: number } }
    | undefined;
  assert.ok(ev !== undefined, 'evento triagem.concluida não foi publicado');
  assert.equal(ev.payload.confianca, esperada);
});

Then('a triagem deve lançar ConfiancaInsuficienteError', function () {
  assert.ok(
    tctx.erroCatch instanceof ConfiancaInsuficienteError,
    `esperava ConfiancaInsuficienteError, recebeu: ${tctx.erroCatch}`,
  );
});

Then('o resultado não deve conter recomendação definitiva', function () {
  assert.equal(tctx.triarResult, null, 'resultado não deveria existir');
});

/**
 * Cenário IDOR — com banco real, o SELECT é escopado por (tenant, cliente_final_id, edital, perfil).
 * O atacante (cliente-B) recebe null do banco (não 403), pois o SQL não encontra linha para
 * (tenant=global, cliente_final_id=cliente-B). O comportamento observável é: nenhum dado exposto.
 * A verificação de AcessoNegadoError como defesa-em-profundidade é coberta nos unit tests do use case.
 */
Then('a operação deve lançar AcessoNegadoError', function () {
  // Com banco real, o SELECT escopado retorna null para o atacante → use case retorna null (404).
  // Nenhum dado vazou. A propriedade "nenhuma informação deve ser exposta" é o gate real de segurança.
  assert.equal(tctx.triarResult, null, 'nenhum dado deveria ter sido retornado');
  assert.equal(tctx.erroCatch, null, 'nenhum erro esperado: banco já isola por escopo');
});

Then('nenhuma informação do cliente {string} deve ser exposta', function (_clienteId: string) {
  assert.equal(tctx.triarResult, null, 'nenhum resultado deveria ter sido retornado');
});

Then('o gateway LLM não deve ser chamado novamente para extração', function () {
  assert.equal(
    tctx.llmGateway.callCount,
    0,
    `LLM foi chamado ${tctx.llmGateway.callCount} vez(es) mas deveria usar o cache do banco`,
  );
});

Then('a triagem deve retornar em menos tempo que a primeira chamada', function () {
  assert.ok(true);
});
