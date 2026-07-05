import { describe, expect, it, vi } from 'vitest';
import { AlertaId, TenantId } from '@radar/kernel';
import { NotificacaoId, UsuarioId } from '../../domain/entities/notificacao.js';
import { NotificacaoEnviada } from '../../application/events.js';
import { SqsEventPublisher } from '../../infra/adapters/sqs-event-publisher.js';

describe('SqsEventPublisher', () => {
  it('propaga AbortSignal até o cliente de fila (P-78)', async () => {
    const signal = new AbortController().signal;
    const client = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const publisher = new SqsEventPublisher(client, 'fila-notificacoes');

    await publisher.publicar(
      new NotificacaoEnviada({
        notificacaoId: NotificacaoId('notificacao-001'),
        tenantId: TenantId('tenant-a'),
        usuarioId: UsuarioId('usuario-001'),
        alertaId: AlertaId('alerta-001'),
        canal: 'EMAIL',
      }),
      signal,
    );

    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
  });
});
