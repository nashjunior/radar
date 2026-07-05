import { Before, DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import {
  CasarEditalComCriteriosUseCase,
  CriterioDeMonitoramento,
  PalavrasChave,
} from '@radar/matching';
import { PostgresCriterioRepository, PostgresAlertaRepository, CryptoAlertaIdProvider } from '@radar/matching/infra';
import type {
  AlertaDTO,
  CriterioComScore,
  EditalParaMatchingDTO,
  AlertaIdProvider,
  AlertaRepository,
  CriterioRepository,
  EditalMatchingView,
  EventPublisher,
  DomainEvent,
} from '@radar/matching';
import { getFixture } from '../support/hooks.js';

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface Ctx {
  criterios: CriterioDeMonitoramento[];
  editalObjeto: string;
  eventosPublicados: DomainEvent[];
  alertasRetornados: AlertaDTO[];
}

const ctx: Ctx = {
  criterios: [],
  editalObjeto: '',
  eventosPublicados: [],
  alertasRetornados: [],
};

Before(function () {
  ctx.criterios = [];
  ctx.editalObjeto = '';
  ctx.eventosPublicados = [];
  ctx.alertasRetornados = [];
});

export { ctx };

// ---------------------------------------------------------------------------
// Scoring in-memory (determinístico para BDD)
// BDD testa COMPORTAMENTO (alerta gerado ou não); a qualidade do SQL ts_rank é
// coberta nos unit tests do PostgresCriterioRepository.
// ---------------------------------------------------------------------------

function computarScore(objeto: string, palavras: string[]): number {
  const objetoNorm = objeto.toLowerCase();
  const acertos = palavras.filter((p) => {
    const escaped = p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(objetoNorm);
  });
  return acertos.length > 0 ? 0.8 : 0.1;
}

// ---------------------------------------------------------------------------
// Repositório híbrido: persiste no Postgres, pontua em memória (BDD determinístico)
// ---------------------------------------------------------------------------

class BddCriterioRepository implements CriterioRepository {
  private readonly real: PostgresCriterioRepository;
  private activeForScoring: CriterioDeMonitoramento[] = [];

  constructor(real: PostgresCriterioRepository) {
    this.real = real;
  }

  setForScoring(criterios: CriterioDeMonitoramento[]): void {
    this.activeForScoring = criterios;
  }

  salvar(criterio: CriterioDeMonitoramento, signal: AbortSignal) {
    return this.real.salvar(criterio, signal);
  }

  porId(id: CriterioId, signal: AbortSignal) {
    return this.real.porId(id, signal);
  }

  listarAtivos(signal: AbortSignal) {
    return this.real.listarAtivos(signal);
  }

  async casarComEdital(edital: EditalParaMatchingDTO, _signal: AbortSignal): Promise<CriterioComScore[]> {
    return this.activeForScoring.map((criterio): CriterioComScore => {
      const palavras = [...(criterio.palavrasChave?.termos ?? [])];
      const score = computarScore(edital.objetoDescricao, palavras);
      return { criterio, score };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildUseCase(): Promise<CasarEditalComCriteriosUseCase> {
  const { db } = getFixture();
  const signal = new AbortController().signal;

  const realCriterioRepo = new PostgresCriterioRepository(db);
  const criterioRepo = new BddCriterioRepository(realCriterioRepo);

  // Persiste critérios do cenário no banco real
  for (const c of ctx.criterios) {
    await realCriterioRepo.salvar(c, signal);
  }
  criterioRepo.setForScoring(ctx.criterios);

  const editaiView: EditalMatchingView = {
    porId: async (id) => ({
      id: id as EditalId,
      tenantScope: 'global' as const,
      modalidadeCodigo: 6,
      objetoDescricao: ctx.editalObjeto,
      uf: 'SP',
      cnae: null,
      valorEstimado: null,
      dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    }),
  };

  const alertaRepo = new PostgresAlertaRepository(db);

  const publisher: EventPublisher = {
    publicar: async (ev) => { ctx.eventosPublicados.push(ev); },
  };

  const alertaIds = new CryptoAlertaIdProvider();

  return new CasarEditalComCriteriosUseCase(
    editaiView, criterioRepo, alertaRepo, publisher, alertaIds,
  );
}

function criarCriterio(clienteId: string, tenantId: string, palavras: string[]): CriterioDeMonitoramento {
  return CriterioDeMonitoramento.criar({
    id: CriterioId(`criterio-${clienteId}`),
    tenantId: TenantId(tenantId),
    clienteFinalId: ClienteFinalId(clienteId),
    palavrasChave: PalavrasChave.criar(palavras),
  });
}

// ---------------------------------------------------------------------------
// Givens
// ---------------------------------------------------------------------------

Given('um repositório de critérios no PostgreSQL', function () {});
Given('um repositório de alertas no PostgreSQL', function () {});

Given(
  'um critério de monitoramento com palavras-chave {string}',
  function (palavrasStr: string) {
    const palavras = palavrasStr.split(' ');
    ctx.criterios = [criarCriterio('cliente-A', 'tenant-alpha', palavras)];
  },
);

Given(
  'um edital com objeto {string}',
  function (objeto: string) {
    ctx.editalObjeto = objeto;
  },
);

Given('dois critérios de monitoramento:', function (tabela: DataTable) {
  ctx.criterios = tabela.hashes().map((row) => {
    const palavras = row['palavrasChave'].trim().split(/\s+/);
    return criarCriterio(row['clienteFinalId'], 'tenant-alpha', palavras);
  });
});

Given(
  'um critério do tenant {string} com palavras-chave {string}',
  function (tenantId: string, palavrasStr: string) {
    const palavras = palavrasStr.split(' ');
    const clienteId = `cliente-${tenantId}`;
    ctx.criterios.push(criarCriterio(clienteId, tenantId, palavras));
  },
);

// ---------------------------------------------------------------------------
// Whens
// ---------------------------------------------------------------------------

When(
  'o sistema executa o casamento do edital com os critérios',
  async function () {
    const uc = await buildUseCase();
    ctx.alertasRetornados = await uc.executar(
      { editalId: EditalId('edital-test-001') },
      new AbortController().signal,
    );
  },
);

// ---------------------------------------------------------------------------
// Thens — verificam alertas persistidos no banco real
// ---------------------------------------------------------------------------

async function contarAlertasNoBanco(): Promise<number> {
  const { pool } = getFixture();
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM alerta');
  return parseInt(rows[0]!.count, 10);
}

async function buscarAlertasNoBanco() {
  const { pool } = getFixture();
  const { rows } = await pool.query<{
    id: string; tenant_id: string; cliente_final_id: string; criterio_id: string;
    edital_id: string; aderencia: string;
  }>('SELECT * FROM alerta');
  return rows;
}

Then('um alerta deve ter sido gerado para o critério', async function () {
  assert.ok(ctx.alertasRetornados.length >= 1, 'nenhum alerta foi retornado pelo use case');
  assert.ok(await contarAlertasNoBanco() >= 1, 'nenhum alerta foi persistido no banco');
});

Then('o alerta deve ter sido persistido no repositório', async function () {
  assert.ok(await contarAlertasNoBanco() >= 1);
});

Then('o evento {string} deve ter sido publicado', function (tipo: string) {
  const encontrado = ctx.eventosPublicados.some((e) => e.type === tipo);
  assert.ok(encontrado, `evento '${tipo}' não foi publicado`);
});

Then('nenhum alerta deve ter sido gerado', async function () {
  assert.equal(ctx.alertasRetornados.length, 0);
  assert.equal(await contarAlertasNoBanco(), 0);
});

Then('nenhum evento deve ter sido publicado', function () {
  assert.equal(ctx.eventosPublicados.length, 0);
});

Then(
  'somente o critério do cliente-A deve ter gerado alerta',
  async function () {
    const alertas = await buscarAlertasNoBanco();
    assert.equal(alertas.length, 1, `esperava 1 alerta, recebeu ${alertas.length}`);
    assert.equal(alertas[0]!.cliente_final_id, ClienteFinalId('cliente-A'));
  },
);

Then(
  'somente o critério do tenant {string} deve ter gerado alerta',
  async function (tenantId: string) {
    const alertas = await buscarAlertasNoBanco();
    assert.equal(alertas.length, 1, `esperava 1 alerta, recebeu ${alertas.length}`);
    assert.equal(alertas[0]!.tenant_id, TenantId(tenantId));
  },
);

Then(
  'o alerta do tenant {string} não contém dados do tenant {string}',
  async function (tenantEsperado: string, tenantProibido: string) {
    const alertas = await buscarAlertasNoBanco();
    const doProibido = alertas.filter((a) => a.tenant_id === TenantId(tenantProibido));
    assert.equal(doProibido.length, 0, `dados do tenant proibido vazaram: ${tenantProibido}`);
    const doEsperado = alertas.filter((a) => a.tenant_id === TenantId(tenantEsperado));
    assert.ok(doEsperado.length >= 1, `nenhum alerta para o tenant esperado: ${tenantEsperado}`);
  },
);
