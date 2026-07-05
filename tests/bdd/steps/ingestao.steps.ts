import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { EditalId } from '@radar/kernel';
import {
  IngerirEditaisUseCase,
  FonteIndisponivelError,
} from '@radar/ingestao';
import type {
  ContratacaoData,
  EditalRepository,
  EventPublisher,
  IdProvider,
  PncpGateway,
  ProvenienciaRepository,
  Edital,
  DomainEvent,
} from '@radar/ingestao';

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface Ctx {
  contratacoes: ContratacaoData[];
  existente: boolean;
  falharPrimeiro: boolean;
  cancelar: boolean;
  editaisArmazenados: Edital[];
  eventosPublicados: DomainEvent[];
  upsertCallCount: number;
  resultado?: Awaited<ReturnType<IngerirEditaisUseCase['executar']>>;
  erro?: Error;
}

const CNPJ_VALIDO = '11222333000181';

function contratacaoBase(numeroControlePncp: string): ContratacaoData {
  return {
    numeroControlePncp,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Serviços de TI',
    valorEstimado: 100000,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
  };
}

let ctx: Ctx;

Before(function () {
  ctx = {
    contratacoes: [],
    existente: false,
    falharPrimeiro: false,
    cancelar: false,
    editaisArmazenados: [],
    eventosPublicados: [],
    upsertCallCount: 0,
  };
});

// ---------------------------------------------------------------------------
// Givens
// ---------------------------------------------------------------------------

Given('um gateway PNCP configurado com dados sintéticos', function () {
  // gateway é montado no When com base nos contratacoes[] do ctx
});

Given('um repositório de editais em memória', function () {
  // repositório é montado no When
});

Given('um publicador de eventos em memória', function () {
  // publisher é montado no When
});

Given(
  'o gateway retorna um edital com numeroControlePNCP {string}',
  function (numero: string) {
    ctx.contratacoes = [contratacaoBase(numero)];
  },
);

Given(
  'o repositório não possui edital com esse número de controle',
  function () {
    ctx.existente = false;
  },
);

Given(
  'o repositório já possui um edital com esse número de controle',
  function () {
    ctx.existente = true;
  },
);

Given(
  'o gateway retorna 2 editais com números de controle distintos',
  function () {
    ctx.contratacoes = [
      contratacaoBase('NUM-001/2024'),
      contratacaoBase('NUM-002/2024'),
    ];
  },
);

Given(
  'o repositório não possui nenhum desses editais',
  function () {
    ctx.existente = false;
  },
);

Given('o gateway retorna 2 editais', function () {
  ctx.contratacoes = [
    contratacaoBase('NUM-001/2024'),
    contratacaoBase('NUM-002/2024'),
  ];
});

Given(
  'o repositório falha temporariamente no primeiro edital',
  function () {
    ctx.falharPrimeiro = true;
  },
);

// ---------------------------------------------------------------------------
// Whens
// ---------------------------------------------------------------------------

function buildDeps(cancelar = false) {
  const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };

  const contratacoes = [...ctx.contratacoes];

  async function* generator(): AsyncGenerator<ContratacaoData[]> {
    if (cancelar) return;
    yield contratacoes;
  }

  const gateway: PncpGateway = {
    buscarContratacoesPorPublicacao: () => generator(),
    buscarContratacoesPorAtualizacao: async function* () {},
    buscarContratacaoPorNumero: async () => null,
    buscarArquivos: async () => [],
    downloadArquivo: async () => new Uint8Array(),
  };

  let callIndex = 0;
  const editais: EditalRepository = {
    upsertPorNumeroControle: async (edital) => {
      callIndex++;
      if (ctx.falharPrimeiro && callIndex === 1) {
        throw new Error('falha temporária simulada');
      }
      ctx.editaisArmazenados.push(edital);
      ctx.upsertCallCount++;
    },
    porId: async () => null,
    porNumeroControle: async () => {
      if (ctx.existente) {
        return { id: EditalId('existente-001') } as unknown as Awaited<ReturnType<EditalRepository['porNumeroControle']>>;
      }
      return null;
    },
    listarPorJanelaPublicacao: async function* () {},
  };

  const proveniencias: ProvenienciaRepository = {
    registrar: async () => {},
  };

  const eventos: EventPublisher = {
    publicar: async (ev) => { ctx.eventosPublicados.push(ev); },
  };

  let idSeq = 0;
  const ids: IdProvider = {
    gerar: () => EditalId(`novo-edital-${++idSeq}`),
  };

  return { gateway, editais, proveniencias, eventos, ids, janela };
}

When(
  'o sistema executa a ingestão para a modalidade {int} na janela de {word} a {word}',
  async function (modalidade: number, _inicio: string, _fim: string) {
    const { gateway, editais, proveniencias, eventos, ids, janela } = buildDeps();
    const uc = new IngerirEditaisUseCase(gateway, editais, proveniencias, eventos, ids);
    try {
      ctx.resultado = await uc.executar({ modalidade, janela }, new AbortController().signal);
    } catch (err) {
      ctx.erro = err as Error;
    }
  },
);

When(
  'o sistema executa a ingestão com um AbortSignal já cancelado',
  async function () {
    const { gateway, editais, proveniencias, eventos, ids, janela } = buildDeps(true);
    const uc = new IngerirEditaisUseCase(gateway, editais, proveniencias, eventos, ids);
    const ac = new AbortController();
    ac.abort();
    try {
      ctx.resultado = await uc.executar({ modalidade: 6, janela }, ac.signal);
    } catch (err) {
      ctx.erro = err as Error;
    }
  },
);

// ---------------------------------------------------------------------------
// Thens
// ---------------------------------------------------------------------------

Then(
  'o repositório deve conter {int} edital persistido',
  function (count: number) {
    assert.equal(ctx.upsertCallCount, count);
  },
);

Then(
  'o repositório deve conter {int} editais persistidos',
  function (count: number) {
    assert.equal(ctx.upsertCallCount, count);
  },
);

Then(
  'o evento {string} deve ter sido publicado {int} vez',
  function (tipo: string, count: number) {
    const filtrados = ctx.eventosPublicados.filter((e) => e.type === tipo);
    assert.equal(filtrados.length, count);
  },
);

Then(
  'o evento {string} deve ter sido publicado {int} vezes',
  function (tipo: string, count: number) {
    const filtrados = ctx.eventosPublicados.filter((e) => e.type === tipo);
    assert.equal(filtrados.length, count);
  },
);

Then(
  'o resumo de ingestão deve reportar {int} edital ingerido e {int} atualizados',
  function (ingeridos: number, atualizados: number) {
    assert.ok(ctx.resultado, 'resultado não disponível');
    assert.equal(ctx.resultado.ingeridos, ingeridos);
    assert.equal(ctx.resultado.atualizados, atualizados);
  },
);

Then(
  'o repositório deve ter recebido {int} chamada de upsert \\(não duplicação)',
  function (count: number) {
    assert.equal(ctx.upsertCallCount, count);
  },
);

Then(
  'o resumo de ingestão deve reportar {int} editais ingeridos e {int} atualizado',
  function (ingeridos: number, atualizados: number) {
    assert.ok(ctx.resultado, 'resultado não disponível');
    assert.equal(ctx.resultado.ingeridos, ingeridos);
    assert.equal(ctx.resultado.atualizados, atualizados);
  },
);

Then(
  'o resumo de ingestão deve reportar {int} editais ingeridos e {int} atualizados',
  function (ingeridos: number, atualizados: number) {
    assert.ok(ctx.resultado, 'resultado não disponível');
    assert.equal(ctx.resultado.ingeridos, ingeridos);
    assert.equal(ctx.resultado.atualizados, atualizados);
  },
);

Then(
  'o resumo de ingestão deve reportar {int} erro e {int} edital ingerido',
  function (erros: number, ingeridos: number) {
    assert.ok(ctx.resultado, 'resultado não disponível');
    assert.equal(ctx.resultado.erros, erros);
    assert.equal(ctx.resultado.ingeridos, ingeridos);
  },
);

Then('nenhum edital deve ter sido persistido', function () {
  assert.equal(ctx.upsertCallCount, 0);
});
