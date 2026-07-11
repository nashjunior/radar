import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { SqsEventPublisher } from '../../infra/adapters/sqs-event-publisher.js';
import { TriagemSolicitada } from '../../application/events.js';

/**
 * Regra do ÚLTIMO HOP (arq/10 §10 / P-78 / RAD-56 #1): o `AbortSignal` deve chegar ao envio real
 * (`sendMessage`), não parar na assinatura do port — senão um pedido já abortado ainda enfileira
 * `triagem.solicitada` → worker roda triagem PAGA órfã (fronteira AB9/cost-DoS).
 */
describe('SqsEventPublisher — propagação do AbortSignal (último hop)', () => {
  const evento = new TriagemSolicitada({
    tenantId: TenantId('global'),
    usuarioId: ClienteFinalId('cliente-1'),
    editalId: EditalId('edital-1'),
    perfilId: PerfilId('perfil-1'),
  });

  it('repassa o signal ao sendMessage (não descarta no adapter)', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const signal = new AbortController().signal;
    const publisher = new SqsEventPublisher({ sendMessage }, 'fila-triagem');

    await publisher.publicar(evento, signal);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [params, opts] = sendMessage.mock.calls[0]!;
    expect(opts).toEqual({ abortSignal: signal }); // MESMA referência do signal recebido em publicar
    expect(params.QueueUrl).toBe('fila-triagem');
    expect(JSON.parse(params.MessageBody)).toMatchObject({
      type: 'triagem.solicitada',
      payload: { tenantId: 'global', editalId: 'edital-1', perfilId: 'perfil-1' },
    });
  });

  it('propaga o abort do client (signal já abortado corta o envio)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // O client concreto (SQS/RabbitMQ) respeita o signal; aqui simulamos rejeitando quando abortado.
    const sendMessage = vi.fn((_p: unknown, opts: { abortSignal: AbortSignal }) =>
      opts.abortSignal.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve(),
    );
    const publisher = new SqsEventPublisher({ sendMessage }, 'fila-triagem');

    await expect(publisher.publicar(evento, ctrl.signal)).rejects.toThrow('aborted');
  });
});
