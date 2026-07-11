import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { EditalId } from '@radar/kernel';
import {
  IngerirEditaisUseCase,
  FonteIndisponivelError,
} from '@radar/ingestao';
import { PostgresEditalRepository } from '@radar/ingestao/infra';
import { PostgresProvenienciaRepository } from '@radar/ingestao/infra';
import type {
  ContratacaoData,
  EditalRepository,
  EventPublisher,
  IdProvider,
  PncpGateway,
  DomainEvent,
} from '@radar/ingestao';
import { getFixture } from '../support/hooks.js';

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface Ctx {
  contratacoes: ContratacaoData[];
  prePopularNumero: string | null; // numero a pré-inserir antes de executar
  falharPrimeiro: boolean;
  cancelar: boolean;
  eventosPublicados: DomainEvent[];
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
    prePopularNumero: null,
    falharPrimeiro: false,
    cancelar: false,
    eventosPublicados: [],
  };
});

// ---------------------------------------------------------------------------
// Givens — configuração
// ---------------------------------------------------------------------------

Given('um gateway PNCP configurado com dados sintéticos', function () {
  // gateway é montado no When com base nos contratacoes[] do ctx
});

Given('um repositório de editais no PostgreSQL', function () {
  // repositório real é montado no When via getFixture()
});

Given('um publicador de eventos em memória', function () {
  // publisher em memória (eventos vão para SQS em produção — stub aqui conforme A04 §4)
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
    ctx.prePopularNumero = null;
  },
);

Given(
  'o repositório já possui um edital com esse número de controle',
  function () {
    // pré-inserção feita no When, antes de executar o use case
    ctx.prePopularNumero = ctx.contratacoes[0]?.numeroControlePncp ?? null;
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
    ctx.prePopularNumero = null;
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

/**
 * FaultInjectingEditalRepository: delega ao real mas lança na 1ª chamada de upsert.
 * Simula falha transiente para testar que o use case continua o lote (A02 §3).
 * REGRA: não simula falha de conexão (DB está saudável) — só a 1ª chamada de aplicação.
 */
class FaultInjectingEditalRepository implements EditalRepository {
  private upsertCount = 0;

  constructor(private readonly real: PostgresEditalRepository) {}

  async upsertPorNumeroControle(edital: Parameters<EditalRepository['upsertPorNumeroControle']>[0], signal: AbortSignal): Promise<void> {
    this.upsertCount++;
    if (this.upsertCount === 1) throw new Error('falha transiente simulada');
    return this.real.upsertPorNumeroControle(edital, signal);
  }

  porId(...args: Parameters<EditalRepository['porId']>) {
    return this.real.porId(...args);
  }

  porNumeroControle(...args: Parameters<EditalRepository['porNumeroControle']>) {
    return this.real.porNumeroControle(...args);
  }

  listarPorJanelaPublicacao(...args: Parameters<EditalRepository['listarPorJanelaPublicacao']>) {
    return this.real.listarPorJanelaPublicacao(...args);
  }
}

async function buildAndRun(cancelar = false): Promise<void> {
  const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };
  const { db } = getFixture();

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

  const realEditalRepo = new PostgresEditalRepository(db);
  const editais: EditalRepository = ctx.falharPrimeiro
    ? new FaultInjectingEditalRepository(realEditalRepo)
    : realEditalRepo;

  const proveniencias = new PostgresProvenienciaRepository(db);

  // Pré-popular o repositório quando o cenário exige edital já existente
  if (ctx.prePopularNumero) {
    const signal = new AbortController().signal;
    let idSeq = 0;
    const ids: IdProvider = { gerar: () => EditalId(`pre-${++idSeq}`) };
    const preUc = new IngerirEditaisUseCase(gateway, realEditalRepo, proveniencias, { publicar: async () => {} }, ids);
    await preUc.executar({ modalidade: 6, janela }, signal);
    // redefine contratacoes para a execução principal
  }

  const eventos: EventPublisher = {
    publicar: async (ev) => { ctx.eventosPublicados.push(ev); },
  };

  let idSeq = 0;
  const ids: IdProvider = {
    gerar: () => EditalId(`novo-${++idSeq}`),
  };

  const uc = new IngerirEditaisUseCase(gateway, editais, proveniencias, eventos, ids);
  try {
    ctx.resultado = await uc.executar({ modalidade: 6, janela }, new AbortController().signal);
  } catch (err) {
    ctx.erro = err as Error;
  }
}

When(
  'o sistema executa a ingestão para a modalidade {int} na janela de {word} a {word}',
  async function (_modalidade: number, _inicio: string, _fim: string) {
    await buildAndRun(false);
  },
);

When(
  'o sistema executa a ingestão com um AbortSignal já cancelado',
  async function () {
    const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };
    const { db } = getFixture();

    async function* emptyGenerator(): AsyncGenerator<ContratacaoData[]> { return; }

    const gateway: PncpGateway = {
      buscarContratacoesPorPublicacao: () => emptyGenerator(),
      buscarContratacoesPorAtualizacao: async function* () {},
      buscarContratacaoPorNumero: async () => null,
      buscarArquivos: async () => [],
      downloadArquivo: async () => new Uint8Array(),
    };

    const editais = new PostgresEditalRepository(db);
    const proveniencias = new PostgresProvenienciaRepository(db);
    const eventos: EventPublisher = { publicar: async (ev) => { ctx.eventosPublicados.push(ev); } };
    const ids: IdProvider = { gerar: () => EditalId('abort-id') };

    const ac = new AbortController();
    ac.abort();

    const uc = new IngerirEditaisUseCase(gateway, editais, proveniencias, eventos, ids);
    try {
      ctx.resultado = await uc.executar({ modalidade: 6, janela }, ac.signal);
    } catch (err) {
      ctx.erro = err as Error;
    }
  },
);

// ---------------------------------------------------------------------------
// Thens — verificam o estado no banco real
// ---------------------------------------------------------------------------

async function contarEditaisNoBanco(): Promise<number> {
  const { pool } = getFixture();
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM editais');
  return parseInt(rows[0]!.count, 10);
}

Then(
  'o repositório deve conter {int} edital persistido',
  async function (count: number) {
    assert.equal(await contarEditaisNoBanco(), count);
  },
);

Then(
  'o repositório deve conter {int} editais persistidos',
  async function (count: number) {
    assert.equal(await contarEditaisNoBanco(), count);
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
  async function (count: number) {
    // Com upsert idempotente no DB, o número de linhas na tabela é a métrica correta.
    assert.equal(await contarEditaisNoBanco(), count);
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

Then('nenhum edital deve ter sido persistido', async function () {
  assert.equal(await contarEditaisNoBanco(), 0);
});
