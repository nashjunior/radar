import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { AlertaId, ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import {
  NotificarAlertaUseCase,
  EnviarDigestUseCase,
  UsuarioId,
} from '@radar/notificacao';
import type {
  AlertaRepository,
  AlertaResumoDTO,
  ClienteFinalGateway,
  DigestPendentesDTO,
  EventPublisher,
  IdProvider,
  NotificacaoRepository,
  Notifier,
  PreferenciaDTO,
  PreferenciaRepository,
} from '@radar/notificacao';
import { ctx as matchingCtx } from './matching.steps.js';

// ---------------------------------------------------------------------------
// Stubs em memória — nenhum serviço real é chamado (A04 §4)
// ---------------------------------------------------------------------------

type DomainEvent = Parameters<EventPublisher['publicar']>[0];

class InMemoryNotifier implements Notifier {
  readonly enviadas: Array<{ destinatario: string; assunto: string }> = [];
  async enviar(params: { canal: unknown; destinatario: string; assunto: string; corpo: string; signal: AbortSignal }): Promise<void> {
    this.enviadas.push({ destinatario: params.destinatario, assunto: params.assunto });
  }
}

class InMemoryNotificacaoRepo implements NotificacaoRepository {
  readonly registros: string[] = [];
  async salvar(n: { id: string }): Promise<void> { this.registros.push(n.id); }
  async jaNotificado(): Promise<boolean> { return false; }
}

class InMemoryPreferenciaRepo implements PreferenciaRepository {
  private readonly map = new Map<string, PreferenciaDTO>();
  definir(p: PreferenciaDTO): void { this.map.set(p.usuarioId, p); }
  async porUsuario(id: string): Promise<PreferenciaDTO | null> { return this.map.get(id) ?? null; }
  async salvar(p: PreferenciaDTO): Promise<void> { this.map.set(p.usuarioId, p); }
}

class InMemoryAlertaRepo implements AlertaRepository {
  private alerta: AlertaResumoDTO | null = null;
  private pendentes: AlertaResumoDTO[] = [];

  definirAlerta(a: AlertaResumoDTO): void { this.alerta = a; }
  definirPendentes(alertas: AlertaResumoDTO[]): void { this.pendentes = alertas; }

  async porId(): Promise<AlertaResumoDTO | null> { return this.alerta; }
  async pendentesDigest(params: { limite: number }): Promise<DigestPendentesDTO> {
    const selecionados = this.pendentes.slice(0, params.limite);
    return { selecionados, excedentes: [], totalPendentes: this.pendentes.length };
  }
}

class InMemoryEventBus implements EventPublisher {
  readonly publicados: DomainEvent[] = [];
  async publicar(evento: DomainEvent): Promise<void> {
    this.publicados.push(evento);
    matchingCtx.eventosPublicados.push(evento);
  }
}

class StubClienteGateway implements ClienteFinalGateway {
  private readonly clientes = new Map<string, { usuarioId: UsuarioId; email: string }>();
  registrar(clienteId: string, usuarioId: string, email: string): void {
    this.clientes.set(clienteId, { usuarioId: UsuarioId(usuarioId), email });
  }
  async porId(id: string): Promise<{ usuarioId: UsuarioId; email: string } | null> {
    return this.clientes.get(id) ?? null;
  }
}

const idProvider: IdProvider = { gerar: () => crypto.randomUUID() };

// ---------------------------------------------------------------------------
// Contexto compartilhado no cenário
// ---------------------------------------------------------------------------

interface NotificacaoCtx {
  notifier: InMemoryNotifier;
  bus: InMemoryEventBus;
  preferenciaRepo: InMemoryPreferenciaRepo;
  alertaRepo: InMemoryAlertaRepo;
  notificacaoRepo: InMemoryNotificacaoRepo;
  clienteGateway: StubClienteGateway;
  usuarioId: UsuarioId;
  clienteId: ClienteFinalId;
  alertaId: AlertaId;
  imediato: boolean;
  digestEnviado: { enviados: number; agrupados: number; total: number } | null;
}

let ctx: NotificacaoCtx;

Before({ tags: '@notificacao or not @notificacao' }, function () {
  // Só reseta se for um cenário de notificação
});

Before(function () {
  ctx = {
    notifier: new InMemoryNotifier(),
    bus: new InMemoryEventBus(),
    preferenciaRepo: new InMemoryPreferenciaRepo(),
    alertaRepo: new InMemoryAlertaRepo(),
    notificacaoRepo: new InMemoryNotificacaoRepo(),
    clienteGateway: new StubClienteGateway(),
    usuarioId: UsuarioId('usuario-bdd-01'),
    clienteId: ClienteFinalId('cliente-bdd-01'),
    alertaId: AlertaId('alerta-bdd-01'),
    imediato: false,
    digestEnviado: null,
  };
});

const signal = new AbortController().signal;

// ---------------------------------------------------------------------------
// Given — usuário e preferência
// ---------------------------------------------------------------------------

Given('um usuário {string} com preferência {string}', function (usuarioId: string, frequencia: string) {
  ctx.usuarioId = UsuarioId(usuarioId);
  ctx.clienteId = ClienteFinalId(`cliente-${usuarioId}`);
  ctx.clienteGateway.registrar(ctx.clienteId, usuarioId, `${usuarioId}@radar.com`);
  ctx.preferenciaRepo.definir({
    usuarioId: ctx.usuarioId,
    canais: ['EMAIL'],
    frequencia: frequencia as 'IMEDIATA' | 'DIARIA' | 'SEMANAL',
  });
});

Given('um usuário {string} sem preferência cadastrada', function (usuarioId: string) {
  ctx.usuarioId = UsuarioId(usuarioId);
  ctx.clienteId = ClienteFinalId(`cliente-${usuarioId}`);
  ctx.clienteGateway.registrar(ctx.clienteId, usuarioId, `${usuarioId}@radar.com`);
  // sem definir preferência → porUsuario retorna null
});

// ---------------------------------------------------------------------------
// Given — alerta
// ---------------------------------------------------------------------------

Given('um alerta com diasAtePrazo {int} e aderência {float}', function (dias: number, aderencia: number) {
  const alerta: AlertaResumoDTO = {
    id: ctx.alertaId,
    objeto: 'Contratação de serviços de TI',
    orgao: 'Prefeitura São Paulo',
    uf: 'SP',
    prazoProposta: new Date(Date.now() + dias * 24 * 60 * 60 * 1000),
    aderencia,
    diasAtePrazo: dias,
    criterioId: CriterioId('criterio-bdd-01'),
    criterioNome: 'Serviços de TI',
  };
  ctx.alertaRepo.definirAlerta(alerta);
  ctx.imediato = (dias >= 0 && dias <= 3) || aderencia >= 0.8;
});

Given('{int} alertas pendentes para o usuário', function (quantidade: number) {
  const pendentes: AlertaResumoDTO[] = Array.from({ length: quantidade }, (_, i) => ({
    id: AlertaId(`alerta-digest-${i}`),
    objeto: `Objeto do alerta ${i + 1}`,
    orgao: 'Órgão Teste',
    uf: 'RJ',
    prazoProposta: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    aderencia: 0.6,
    diasAtePrazo: 10,
    criterioId: CriterioId('criterio-bdd-01'),
    criterioNome: 'Critério Teste',
  }));
  ctx.alertaRepo.definirPendentes(pendentes);
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('o sistema processa a notificação do alerta', async function () {
  const uc = new NotificarAlertaUseCase(
    ctx.alertaRepo,
    ctx.preferenciaRepo,
    ctx.notificacaoRepo,
    ctx.notifier,
    ctx.bus,
    idProvider,
    ctx.clienteGateway,
  );
  await uc.executar(
    {
      alertaId: ctx.alertaId,
      clienteFinalId: ctx.clienteId,
      tenantId: TenantId('tenant-bdd'),
      alertaGeradoEm: new Date(),
      imediato: ctx.imediato,
    },
    signal,
  );
});

When('o scheduler dispara o envio do digest', async function () {
  const uc = new EnviarDigestUseCase(
    ctx.alertaRepo,
    ctx.preferenciaRepo,
    ctx.notificacaoRepo,
    ctx.notifier,
    ctx.bus,
    idProvider,
  );
  ctx.digestEnviado = await uc.executar(
    {
      usuarioId: ctx.usuarioId,
      tenantId: TenantId('tenant-bdd'),
      emailDestinatario: `${ctx.usuarioId}@radar.com`,
      janela: { inicio: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    signal,
  );
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('uma notificação deve ter sido enviada imediatamente', function () {
  assert.equal(ctx.notifier.enviadas.length, 1, 'Esperava exatamente 1 notificação enviada');
});

Then('nenhuma notificação deve ter sido enviada neste ciclo', function () {
  assert.equal(ctx.notifier.enviadas.length, 0, 'Esperava 0 notificações enviadas');
});

Then('o digest deve ter sido enviado com {int} alertas', function (quantidade: number) {
  assert.ok(ctx.digestEnviado, 'EnviarDigestUseCase não foi executado');
  assert.equal(ctx.digestEnviado.enviados, quantidade, `Esperava ${quantidade} alertas no digest, recebeu ${ctx.digestEnviado.enviados}`);
  assert.equal(ctx.notifier.enviadas.length, 1, 'Esperava exatamente 1 email de digest enviado');
});
