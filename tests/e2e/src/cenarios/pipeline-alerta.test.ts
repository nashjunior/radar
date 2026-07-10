/**
 * E2E — Pipeline edital.ingerido → matching → alerta.gerado → notificação.
 *
 * Harness: Testcontainers (Postgres efêmero) + barramento em memória.
 * REGRA DURA: nenhum request ao PNCP real nem ao LLM real (A04 §4).
 *
 * Cenários cobertos:
 * CE-01 — edital casa com critério → alerta persistido + alerta.gerado publicado
 * CE-02 — alerta.gerado → notificação enviada + notificacao persistida em DB
 * CE-03 — pipeline fim-a-fim: critério → casamento → alerta → notificação
 * CE-04 — idempotência: mesmo alerta não gera segunda notificação
 * CE-05 — edital sem casamento → nenhum alerta gerado
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import {
  CasarEditalComCriteriosUseCase,
  DefinirCriterioMonitoramentoUseCase,
  type ClockProvider,
  type EditalParaMatchingDTO,
  type FaixaValorReferencia,
  type FieldCryptoProvider,
} from '@radar/matching';
import { PostgresCriterioRepository, PostgresAlertaRepository, CryptoCriterioIdProvider, CryptoAlertaIdProvider } from '@radar/matching/infra';
import {
  NotificarAlertaUseCase,
  UsuarioId,
} from '@radar/notificacao';
import {
  PostgresNotificacaoRepository,
  PostgresPreferenciaRepository,
  NotificacaoWorker,
} from '@radar/notificacao/infra';

import { startDb, teardownDb, type DbFixture } from '../helpers/db.js';
import { InMemoryEventBus } from '../helpers/event-bus.js';
import { InMemoryAlertaView } from '../stubs/in-memory-alerta-view.js';
import { InMemoryClienteFinalGateway } from '../stubs/in-memory-cliente-gateway.js';
import { CaptureNotifier } from '../stubs/capture-notifier.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = TenantId('tenant-teste');
const CLIENTE = ClienteFinalId('cliente-001');
const USUARIO = UsuarioId('usuario-001');

const editalTi: EditalParaMatchingDTO = {
  id: EditalId('edital-ti-001'),
  tenantScope: 'global',
  modalidadeCodigo: 1,
  objetoDescricao: 'Contratação de serviços de TI e desenvolvimento de software',
  uf: 'SP',
  cnae: '62.01',
  valorEstimado: 300_000,
  dataPublicacao: new Date('2026-07-01'),
};

const editalSemCasamento: EditalParaMatchingDTO = {
  id: EditalId('edital-obras-001'),
  tenantScope: 'global',
  modalidadeCodigo: 2,
  objetoDescricao: 'Construção de ponte sobre o rio Tietê',
  uf: 'SP',
  cnae: '41.10',
  valorEstimado: 5_000_000,
  dataPublicacao: new Date('2026-07-01'),
};

const faixasRefVazia: FaixaValorReferencia = {
  faixasVigentes: async () => [],
};

const clock: ClockProvider = { agora: () => new Date('2026-07-05T12:00:00Z') };
const fieldCrypto: FieldCryptoProvider = {
  cifrarTexto: async (valor) => valor,
  decifrarTexto: async (valor) => valor,
};

// ---------------------------------------------------------------------------
// Setup global — 1 container por suite (compartilhado, schema limpo entre testes)
// ---------------------------------------------------------------------------

let fixture: DbFixture;

beforeAll(async () => {
  fixture = await startDb();
}, 90_000);

afterAll(async () => {
  await teardownDb(fixture);
});

// Limpa as tabelas antes de cada teste para isolamento
beforeEach(async () => {
  await fixture.pool.query(
    `TRUNCATE criterio_monitoramento, alerta, notificacao, usuario_preferencia`,
  );
});

// ---------------------------------------------------------------------------
// Helpers de composição
// ---------------------------------------------------------------------------

function criarHarness() {
  const bus = new InMemoryEventBus();
  const alertaView = new InMemoryAlertaView();
  const clienteGateway = new InMemoryClienteFinalGateway();
  const notifier = new CaptureNotifier();

  const criterioRepo = new PostgresCriterioRepository(fixture.db, fieldCrypto);
  const alertaRepo = new PostgresAlertaRepository(fixture.db);
  const notificacaoRepo = new PostgresNotificacaoRepository(fixture.db);
  const preferenciaRepo = new PostgresPreferenciaRepository(fixture.db);

  const criterioIds = new CryptoCriterioIdProvider();
  const alertaIds = new CryptoAlertaIdProvider();

  // Publisher de matching: quando publica alerta.gerado, dispara o worker de notificação
  const matchingPublisher = bus.asPublisher();
  const notificacaoPublisher = bus.asPublisher();

  const notificarAlertaUC = new NotificarAlertaUseCase(
    alertaView,
    preferenciaRepo,
    notificacaoRepo,
    notifier,
    notificacaoPublisher,
    { gerar: () => crypto.randomUUID() },
    clienteGateway,
  );

  const worker = new NotificacaoWorker(notificarAlertaUC, {
    encaminhar: async () => {},
  });

  // Liga alerta.gerado → notificacao worker
  bus.subscribe('alerta.gerado', async (payload, signal) => {
    const { alertaId, tenantId, clienteFinalId } = payload as {
      alertaId: string;
      tenantId: string;
      clienteFinalId: string;
    };
    // Disponibiliza o resumo do alerta para o use case de notificação
    const alertaDTO = await alertaRepo.porId(AlertaId(alertaId), signal);
    if (alertaDTO) {
      alertaView.registrar({
        id: AlertaId(alertaId),
        objeto: editalTi.objetoDescricao,
        orgao: 'Órgão Teste',
        uf: editalTi.uf,
        prazoProposta: new Date('2026-07-10'),
        aderencia: alertaDTO.aderencia.valor,
        diasAtePrazo: 5,
      });
    }

    await worker.processar(
      { alertaId, tenantId, clienteFinalId },
      signal,
    );
  });

  // P-97: edital passado diretamente do evento; sem EditalMatchingView cross-context
  const casarUC = new CasarEditalComCriteriosUseCase(
    criterioRepo,
    alertaRepo,
    matchingPublisher,
    alertaIds,
  );

  const definirCriterioUC = new DefinirCriterioMonitoramentoUseCase(
    criterioRepo,
    faixasRefVazia,
    bus.asPublisher(),
    criterioIds,
    clock,
  );

  return {
    bus,
    alertaView,
    clienteGateway,
    notifier,
    casarUC,
    definirCriterioUC,
    criterioRepo,
    alertaRepo,
    notificacaoRepo,
  };
}

const signal = new AbortController().signal;

// ---------------------------------------------------------------------------
// CE-01: edital casa com critério → alerta persistido + evento publicado
// ---------------------------------------------------------------------------

describe('CE-01 — casamento de edital com critério', () => {
  it('gera alerta e publica alerta.gerado quando score supera limiar', async () => {
    const { clienteGateway, definirCriterioUC, casarUC, bus } = criarHarness();

    clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'usuario@teste.com' });

    // ramoCnae sem palavrasChave → score ELSE 0.5 > 0.3 (caminho ELSE do SQL)
    await definirCriterioUC.executar(
      {
        tenantId: TENANT,
        clienteFinalId: CLIENTE,
        ramoCnae: '62.01',
        regiaoUf: 'SP',
      },
      signal,
    );

    const alertas = await casarUC.executar({ edital: editalTi }, signal);

    expect(alertas.length).toBeGreaterThanOrEqual(1);
    expect(alertas[0]?.editalId).toBe(editalTi.id);
    expect(alertas[0]?.aderencia).toBeGreaterThanOrEqual(0.3);

    const publicados = bus.published.filter(e => e.type === 'alerta.gerado');
    expect(publicados).toHaveLength(alertas.length);
  });
});

// ---------------------------------------------------------------------------
// CE-02: alerta.gerado → notificação enviada e persistida
// ---------------------------------------------------------------------------

describe('CE-02 — notificação disparada por alerta.gerado', () => {
  it('envia notificação e persiste registro quando usuario tem preferência IMEDIATA', async () => {
    const { clienteGateway, definirCriterioUC, casarUC, notifier, notificacaoRepo } =
      criarHarness();

    clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'usuario@empresa.com' });

    // Preferência IMEDIATA para o usuario
    await fixture.pool.query(
      `INSERT INTO usuario_preferencia (usuario_id, canais, frequencia, atualizada_em)
       VALUES ($1, $2, $3, NOW())`,
      [USUARIO, ['EMAIL'], 'IMEDIATA'],
    );

    await definirCriterioUC.executar(
      { tenantId: TENANT, clienteFinalId: CLIENTE, ramoCnae: '62.01' },
      signal,
    );

    await casarUC.executar({ edital: editalTi }, signal);

    expect(notifier.enviadas.length).toBeGreaterThanOrEqual(1);
    const enviada = notifier.enviadas[0];
    expect(enviada).toBeDefined();
    expect(enviada!.destinatario).toBe('usuario@empresa.com');

    const { rows } = await fixture.pool.query(
      `SELECT * FROM notificacao WHERE usuario_id = $1`,
      [USUARIO],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect((rows[0] as { status: string }).status).toBe('ENVIADA');
  });
});

// ---------------------------------------------------------------------------
// CE-03: pipeline fim-a-fim com verificação em DB
// ---------------------------------------------------------------------------

describe('CE-03 — pipeline fim-a-fim', () => {
  it('persiste criterio, alerta e notificacao no Postgres em sequência correta', async () => {
    const { clienteGateway, definirCriterioUC, casarUC, notifier } = criarHarness();

    clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'cli@radar.com' });

    await fixture.pool.query(
      `INSERT INTO usuario_preferencia (usuario_id, canais, frequencia, atualizada_em)
       VALUES ($1, $2, $3, NOW())`,
      [USUARIO, ['EMAIL'], 'IMEDIATA'],
    );

    const criterioDTO = await definirCriterioUC.executar(
      { tenantId: TENANT, clienteFinalId: CLIENTE, ramoCnae: '62.01' },
      signal,
    );

    const { rows: criterioRows } = await fixture.pool.query(
      `SELECT * FROM criterio_monitoramento WHERE id = $1`,
      [criterioDTO.id],
    );
    expect(criterioRows).toHaveLength(1);

    const alertas = await casarUC.executar({ edital: editalTi }, signal);
    expect(alertas.length).toBeGreaterThanOrEqual(1);

    const { rows: alertaRows } = await fixture.pool.query(
      `SELECT * FROM alerta WHERE edital_id = $1`,
      [editalTi.id],
    );
    expect(alertaRows).toHaveLength(alertas.length);

    expect(notifier.enviadas.length).toBeGreaterThanOrEqual(1);

    const { rows: notifRows } = await fixture.pool.query(
      `SELECT * FROM notificacao WHERE status = 'ENVIADA'`,
    );
    expect(notifRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// CE-04: idempotência — reprocessamento do mesmo alertaId não gera 2ª notificação
// ---------------------------------------------------------------------------

describe('CE-04 — idempotência de notificação', () => {
  it('não reprocessa alerta já entregue ao reprocessar a mesma mensagem da fila', async () => {
    const { clienteGateway, definirCriterioUC, casarUC, notifier, alertaRepo } =
      criarHarness();

    clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'idem@radar.com' });

    await fixture.pool.query(
      `INSERT INTO usuario_preferencia (usuario_id, canais, frequencia, atualizada_em)
       VALUES ($1, $2, $3, NOW())`,
      [USUARIO, ['EMAIL'], 'IMEDIATA'],
    );

    await definirCriterioUC.executar(
      { tenantId: TENANT, clienteFinalId: CLIENTE, ramoCnae: '62.01' },
      signal,
    );

    // Primeira execução → alerta gerado e notificado
    const alertas = await casarUC.executar({ edital: editalTi }, signal);
    expect(alertas.length).toBeGreaterThanOrEqual(1);
    expect(notifier.enviadas.length).toBeGreaterThanOrEqual(1);
    const enviosAposFirstRun = notifier.enviadas.length;

    // Simulação de reprocessamento de mensagem: o bus reprocessa o MESMO alertaId
    // (redelivery real de SQS após falha parcial — idempotência via jaNotificado)
    const primeiroAlerta = alertas[0]!;
    const alertaDb = await alertaRepo.porId(AlertaId(primeiroAlerta.id), signal);
    expect(alertaDb).not.toBeNull();

    // Chama o worker diretamente com o mesmo alertaId
    const { NotificacaoWorker: Worker } = await import('@radar/notificacao/infra');
    const {
      NotificarAlertaUseCase: UC,
    } = await import('@radar/notificacao');
    const {
      PostgresNotificacaoRepository: NotifRepo,
      PostgresPreferenciaRepository: PrefRepo,
    } = await import('@radar/notificacao/infra');

    const notifRepo2 = new NotifRepo(fixture.db);
    const prefRepo2 = new PrefRepo(fixture.db);
    const { InMemoryAlertaView: AlertaViewCls } = await import('../stubs/in-memory-alerta-view.js');
    const alertaView2 = new AlertaViewCls();
    alertaView2.registrar({
      id: AlertaId(primeiroAlerta.id),
      objeto: editalTi.objetoDescricao,
      orgao: 'Órgão Teste',
      uf: editalTi.uf,
      prazoProposta: new Date('2026-07-10'),
      aderencia: primeiroAlerta.aderencia,
      diasAtePrazo: 5,
    });

    const notifier2 = notifier; // mesmo notifier para contar envios

    const uc2 = new UC(
      alertaView2,
      prefRepo2,
      notifRepo2,
      notifier2,
      { publicar: async () => {} },
      { gerar: () => crypto.randomUUID() },
      clienteGateway,
    );

    const worker2 = new Worker(uc2, { encaminhar: async () => {} });

    await worker2.processar(
      {
        alertaId: primeiroAlerta.id,
        tenantId: TENANT,
        clienteFinalId: CLIENTE,
      },
      signal,
    );

    // Nenhuma notificação adicional deve ter sido enviada
    expect(notifier.enviadas.length).toBe(enviosAposFirstRun);
  });
});

// ---------------------------------------------------------------------------
// CE-05: edital sem casamento → nenhum alerta
// ---------------------------------------------------------------------------

describe('CE-05 — edital sem critério correspondente', () => {
  it('não gera alertas quando edital não casa com nenhum critério ativo', async () => {
    const { clienteGateway, definirCriterioUC, casarUC } = criarHarness();

    clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'nada@radar.com' });

    // Critério de TI (CNAE 62.01) — edital de obras tem CNAE 41.10 → mismatch
    await definirCriterioUC.executar(
      { tenantId: TENANT, clienteFinalId: CLIENTE, ramoCnae: '62.01' },
      signal,
    );

    const alertas = await casarUC.executar({ edital: editalSemCasamento }, signal);

    expect(alertas).toHaveLength(0);

    const { rows } = await fixture.pool.query(`SELECT * FROM alerta`);
    expect(rows).toHaveLength(0);
  });
});
