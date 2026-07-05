import { Before, DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import {
  CasarEditalComCriteriosUseCase,
  CriterioDeMonitoramento,
  PalavrasChave,
} from '@radar/matching';
import type {
  AlertaDTO,
  CriterioComScore,
  EditalParaMatchingDTO,
  AlertaIdProvider,
  AlertaRepository,
  CriterioRepository,
  EditalMatchingView,
  EventPublisher,
  Alerta,
  DomainEvent,
} from '@radar/matching';

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface Ctx {
  criterios: CriterioDeMonitoramento[];
  editalObjeto: string;
  alertasSalvos: Alerta[];
  eventosPublicados: DomainEvent[];
  alertasRetornados: AlertaDTO[];
}

let ctx: Ctx;

Before(function () {
  ctx = {
    criterios: [],
    editalObjeto: '',
    alertasSalvos: [],
    eventosPublicados: [],
    alertasRetornados: [],
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computarScore(objeto: string, palavras: string[]): number {
  const objetoNorm = objeto.toLowerCase();
  const acertos = palavras.filter((p) => objetoNorm.includes(p.toLowerCase()));
  return acertos.length > 0 ? 0.8 : 0.1;
}

function buildUseCase(): CasarEditalComCriteriosUseCase {
  const criteriosAtivos = [...ctx.criterios];

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

  const criterioRepo: CriterioRepository = {
    salvar: async () => {},
    porId: async () => null,
    listarAtivos: async () => criteriosAtivos,
    casarComEdital: async (edital) => {
      return criteriosAtivos.map((criterio): CriterioComScore => {
        const palavras = criterio.palavrasChave?.termos ?? [];
        const score = computarScore(edital.objetoDescricao, palavras);
        return { criterio, score };
      });
    },
  };

  const alertaRepo: AlertaRepository = {
    salvar: async (alerta) => { ctx.alertasSalvos.push(alerta); },
    porId: async () => null,
    atualizarFeedback: async () => {},
  };

  const publisher: EventPublisher = {
    publicar: async (ev) => { ctx.eventosPublicados.push(ev); },
  };

  let alertaSeq = 0;
  const alertaIds: AlertaIdProvider = {
    gerar: () => AlertaId(`alerta-${++alertaSeq}`),
  };

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

Given('um repositório de critérios em memória', function () {});
Given('um repositório de alertas em memória', function () {});
Given('um publicador de eventos em memória', function () {});

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
    const uc = buildUseCase();
    ctx.alertasRetornados = await uc.executar(
      { editalId: EditalId('edital-test-001') },
      new AbortController().signal,
    );
  },
);

// ---------------------------------------------------------------------------
// Thens
// ---------------------------------------------------------------------------

Then('um alerta deve ter sido gerado para o critério', function () {
  assert.ok(ctx.alertasSalvos.length >= 1, 'nenhum alerta foi salvo');
});

Then('o alerta deve ter sido persistido no repositório', function () {
  assert.ok(ctx.alertasSalvos.length >= 1);
});

Then('o evento {string} deve ter sido publicado', function (tipo: string) {
  const encontrado = ctx.eventosPublicados.some((e) => e.type === tipo);
  assert.ok(encontrado, `evento '${tipo}' não foi publicado`);
});

Then('nenhum alerta deve ter sido gerado', function () {
  assert.equal(ctx.alertasSalvos.length, 0);
});

Then('nenhum evento deve ter sido publicado', function () {
  assert.equal(ctx.eventosPublicados.length, 0);
});

Then(
  'somente o critério do cliente-A deve ter gerado alerta',
  function () {
    assert.equal(ctx.alertasSalvos.length, 1);
    assert.equal(ctx.alertasSalvos[0]!.clienteFinalId, ClienteFinalId('cliente-A'));
  },
);

Then(
  'somente o critério do tenant {string} deve ter gerado alerta',
  function (tenantId: string) {
    assert.equal(ctx.alertasSalvos.length, 1);
    assert.equal(ctx.alertasSalvos[0]!.tenantId, TenantId(tenantId));
  },
);

Then(
  'o alerta do tenant {string} não contém dados do tenant {string}',
  function (tenantEsperado: string, tenantProibido: string) {
    const alertasDoTenantProibido = ctx.alertasSalvos.filter(
      (a) => a.tenantId === TenantId(tenantProibido),
    );
    assert.equal(alertasDoTenantProibido.length, 0);
    const alertasDoTenantEsperado = ctx.alertasSalvos.filter(
      (a) => a.tenantId === TenantId(tenantEsperado),
    );
    assert.ok(alertasDoTenantEsperado.length >= 1);
  },
);
