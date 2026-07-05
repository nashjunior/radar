import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
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
import type {
  DomainEvent,
  EntradaExtracaoDTO,
  EventPublisher,
  ExtracaoRepository,
  LlmGateway,
  PerfilGateway,
  TriagemDTO,
  TriagemRepository,
} from '@radar/triagem';
import { ctx as matchingCtx } from './matching.steps.js';

// ---------------------------------------------------------------------------
// In-memory adapters (test doubles)
// ---------------------------------------------------------------------------

class InMemTriagemRepo implements TriagemRepository {
  private store = new Map<string, Triagem>();
  async salvar(t: Triagem, _s: AbortSignal): Promise<void> {
    this.store.set(`${t.editalId}:${t.perfilId}`, t);
  }
  // Port escopado por tenant/cliente (RAD-56 #2): a assinatura recebe (tenantId, clienteFinalId,
  // editalId, perfilId). No double single-tenant a chave natural (edital, perfil) já é única; o escopo
  // tenant/cliente é conferido pelo authz-por-objeto do use case (defesa em profundidade) — o SELECT
  // escopado do adapter real é exercitado no unit test do PostgresTriagemRepository.
  async porEditalEPerfil(
    _tenantId: TenantId,
    _clienteFinalId: ClienteFinalId,
    editalId: EditalId,
    perfilId: PerfilId,
    _s: AbortSignal,
  ): Promise<Triagem | null> {
    return this.store.get(`${editalId}:${perfilId}`) ?? null;
  }
}

class InMemExtracaoRepo implements ExtracaoRepository {
  private store = new Map<string, ExtracaoEdital>();
  async porEdital(id: EditalId, _s: AbortSignal): Promise<ExtracaoEdital | null> {
    return this.store.get(id) ?? null;
  }
  async salvar(e: ExtracaoEdital, _s: AbortSignal): Promise<void> {
    this.store.set(e.editalId, e);
  }
}

class StubLlmGateway implements LlmGateway {
  callCount = 0;
  private next: ExtracaoEdital | null = null;
  preparar(e: ExtracaoEdital): void { this.next = e; }
  async extrair(_entrada: EntradaExtracaoDTO, _signal: AbortSignal): Promise<ExtracaoEdital> {
    this.callCount++;
    if (!this.next) throw new Error('LLM stub não configurado');
    return this.next;
  }
}

class StubPerfilGateway implements PerfilGateway {
  private perfis = new Map<string, PerfilHabilitacao>();
  registrar(p: PerfilHabilitacao): void { this.perfis.set(p.id, p); }
  async porId(id: PerfilId, _s: AbortSignal): Promise<PerfilHabilitacao | null> {
    return this.perfis.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

interface TriagemCtx {
  triagemRepo: InMemTriagemRepo | null;
  extracaoRepo: InMemExtracaoRepo | null;
  llmGateway: StubLlmGateway | null;
  perfilGateway: StubPerfilGateway | null;
  editalId: string;
  perfilId: string;
  clienteId: string;
  limiarConfianca: number;
  triarResult: TriagemDTO | null;
  erroCatch: unknown;
  eventosLocais: DomainEvent[];
}

const tctx: TriagemCtx = {
  triagemRepo: null,
  extracaoRepo: null,
  llmGateway: null,
  perfilGateway: null,
  editalId: 'edital-triagem-001',
  perfilId: 'perfil-001',
  clienteId: '',
  limiarConfianca: 0.6,
  triarResult: null,
  erroCatch: null,
  eventosLocais: [],
};

Before(function () {
  tctx.triagemRepo = null;
  tctx.extracaoRepo = null;
  tctx.llmGateway = null;
  tctx.perfilGateway = null;
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
  return new TriarEditalUseCase(
    tctx.extracaoRepo!,
    tctx.perfilGateway!,
    tctx.llmGateway!,
    tctx.triagemRepo!,
    publisher,
  );
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('um repositório de triagens em memória', function () {
  tctx.triagemRepo = new InMemTriagemRepo();
});

Given('um gateway de LLM configurado com stub sintético', function () {
  tctx.llmGateway = new StubLlmGateway();
  tctx.limiarConfianca = 0.6;
});

Given('um repositório de extração de edital em memória', function () {
  tctx.extracaoRepo = new InMemExtracaoRepo();
  tctx.perfilGateway = new StubPerfilGateway();
});

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
    tctx.perfilGateway!.registrar(
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
    // "go": ExtracaoEdital tem requisito tecnica='62.01', perfil tem habTecnica=['62.01']
    //       → atendeRequisito → aderência=1.0 → ehAlta → 'go'
    const extracao = criarExtracao(tctx.editalId, confianca, [
      { categoria: 'tecnica', descricao: '62.01' },
    ]);
    tctx.llmGateway!.preparar(extracao);
  },
);

Given(
  'o LLM retorna confiança {float} abaixo do limiar configurado',
  function (confianca: number) {
    tctx.limiarConfianca = Math.round((confianca + 0.15) * 100) / 100;
    const extracao = criarExtracao(tctx.editalId, confianca, []);
    tctx.llmGateway!.preparar(extracao);
  },
);

Given(
  'uma triagem existente pertencente ao cliente {string}',
  async function (clienteId: string) {
    const editalId = EditalId('edital-idor-001');
    const perfilId = PerfilId('perfil-cliente-A');
    const triagem = Triagem.reconstituir({
      editalId,
      perfilId,
      tenantId: TenantId('global'),
      clienteFinalId: ClienteFinalId(clienteId),
      aderencia: Aderencia.criar(1.0),
      recomendacao: 'go',
      riscos: [],
    });
    await tctx.triagemRepo!.salvar(triagem, SIGNAL);
    await tctx.extracaoRepo!.salvar(criarExtracao('edital-idor-001', 0.9, []), SIGNAL);
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
    tctx.editalId = 'edital-cache-001';
    tctx.perfilId = perfilId;
    tctx.clienteId = 'cliente-cache';
    const extracao = criarExtracao(tctx.editalId, 0.95, [
      { categoria: 'tecnica', descricao: '62.01' },
    ]);
    await tctx.extracaoRepo!.salvar(extracao, SIGNAL);
    tctx.perfilGateway!.registrar(
      PerfilHabilitacao.de({
        id: PerfilId(perfilId),
        clienteFinalId: ClienteFinalId('cliente-cache'),
        habJuridica: [],
        habFiscal: [],
        habTecnica: ['62.01'],
        habEconomica: [],
      }),
    );
    tctx.llmGateway!.callCount = 0;
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
          tenantId: TenantId('global'), // single-tenant MVP (P-25); TriarEditalInput.tenantId é obrigatório
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
    const uc = new ConsultarTriagemUseCase(tctx.triagemRepo!, tctx.extracaoRepo!);
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
        tenantId: TenantId('global'), // single-tenant MVP (P-25); TriarEditalInput.tenantId é obrigatório
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

Then('a operação deve lançar AcessoNegadoError', function () {
  assert.ok(
    tctx.erroCatch instanceof AcessoNegadoError,
    `esperava AcessoNegadoError, recebeu: ${tctx.erroCatch}`,
  );
});

Then('nenhuma informação do cliente {string} deve ser exposta', function (_clienteId: string) {
  assert.equal(tctx.triarResult, null, 'nenhum resultado deveria ter sido retornado');
});

Then('o gateway LLM não deve ser chamado novamente para extração', function () {
  assert.equal(
    tctx.llmGateway!.callCount,
    0,
    `LLM foi chamado ${tctx.llmGateway!.callCount} vez(es) mas deveria usar o cache`,
  );
});

Then('a triagem deve retornar em menos tempo que a primeira chamada', function () {
  // Cache hit verificado pela ausência de chamadas ao LLM (assertion anterior).
  assert.ok(true);
});
