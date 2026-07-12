import { describe, expect, it, vi } from 'vitest';
import { AlertaId, TenantId } from '@radar/kernel';
import type { AlertaDevidoRepository } from '@radar/matching';
import { NotificacaoEnviada, NotificacaoId, UsuarioId } from '@radar/notificacao';
import type { Logger } from '@radar/observabilidade';
import { criarEventPublisherComCoberturaPrazoCritico } from '../cobertura-prazo-critico-assinante.js';

const signal = new AbortController().signal;

function criarLoggerMudo(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function criarEvento(overrides: Partial<{ alertaGeradoEm: Date }> = {}): NotificacaoEnviada {
  return new NotificacaoEnviada({
    notificacaoId: NotificacaoId('notif-1'),
    tenantId: TenantId('tenant-1'),
    usuarioId: UsuarioId('usuario-1'),
    alertaId: AlertaId('alerta-1'),
    canal: 'EMAIL',
    ...overrides,
  });
}

describe('criarEventPublisherComCoberturaPrazoCritico', () => {
  it('marca notificado_em chaveado por alertaId no caminho imediato (com alertaGeradoEm)', async () => {
    const marcarNotificado = vi.fn().mockResolvedValue(undefined);
    const alertaDevidos: AlertaDevidoRepository = { registrarLote: vi.fn(), marcarNotificado };
    const internoPublicar = vi.fn().mockResolvedValue(undefined);
    const publisher = criarEventPublisherComCoberturaPrazoCritico(
      { publicar: internoPublicar },
      alertaDevidos,
      criarLoggerMudo(),
    );

    const evento = criarEvento({ alertaGeradoEm: new Date('2026-01-01T00:00:00Z') });
    await publisher.publicar(evento, signal);

    expect(marcarNotificado).toHaveBeenCalledWith(AlertaId('alerta-1'), evento.occurredAt, signal);
    expect(internoPublicar).toHaveBeenCalledWith(evento, signal);
  });

  it('marca notificado_em no caminho digest (sem alertaGeradoEm) — chave é alertaId, não o instante do alerta', async () => {
    const marcarNotificado = vi.fn().mockResolvedValue(undefined);
    const alertaDevidos: AlertaDevidoRepository = { registrarLote: vi.fn(), marcarNotificado };
    const publisher = criarEventPublisherComCoberturaPrazoCritico(
      { publicar: vi.fn().mockResolvedValue(undefined) },
      alertaDevidos,
      criarLoggerMudo(),
    );

    const evento = criarEvento(); // sem alertaGeradoEm — caminho digest
    await publisher.publicar(evento, signal);

    expect(marcarNotificado).toHaveBeenCalledWith(AlertaId('alerta-1'), evento.occurredAt, signal);
  });

  it('alerta sem linha na projeção é no-op silencioso — repositório resolve sem erro e o publish segue', async () => {
    const marcarNotificado = vi.fn().mockResolvedValue(undefined); // UPDATE afeta 0 linhas — repo não lança
    const alertaDevidos: AlertaDevidoRepository = { registrarLote: vi.fn(), marcarNotificado };
    const internoPublicar = vi.fn().mockResolvedValue(undefined);
    const publisher = criarEventPublisherComCoberturaPrazoCritico(
      { publicar: internoPublicar },
      alertaDevidos,
      criarLoggerMudo(),
    );

    await publisher.publicar(criarEvento(), signal);

    expect(internoPublicar).toHaveBeenCalledTimes(1);
  });

  it('falha ao marcar a projeção não impede o publish real do evento', async () => {
    const marcarNotificado = vi.fn().mockRejectedValue(new Error('conexão caiu'));
    const alertaDevidos: AlertaDevidoRepository = { registrarLote: vi.fn(), marcarNotificado };
    const internoPublicar = vi.fn().mockResolvedValue(undefined);
    const logger = criarLoggerMudo();
    const publisher = criarEventPublisherComCoberturaPrazoCritico(
      { publicar: internoPublicar },
      alertaDevidos,
      logger,
    );

    await publisher.publicar(criarEvento(), signal);

    expect(internoPublicar).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'cobertura-prazo-critico.marcar-notificado-falhou',
      expect.any(String),
      expect.objectContaining({ alertaId: AlertaId('alerta-1') }),
    );
  });

  it('ignora eventos que não são notificacao.enviada', async () => {
    const marcarNotificado = vi.fn();
    const alertaDevidos: AlertaDevidoRepository = { registrarLote: vi.fn(), marcarNotificado };
    const internoPublicar = vi.fn().mockResolvedValue(undefined);
    const publisher = criarEventPublisherComCoberturaPrazoCritico(
      { publicar: internoPublicar },
      alertaDevidos,
      criarLoggerMudo(),
    );

    await publisher.publicar({ type: 'outro.evento' }, signal);

    expect(marcarNotificado).not.toHaveBeenCalled();
    expect(internoPublicar).toHaveBeenCalledTimes(1);
  });
});
