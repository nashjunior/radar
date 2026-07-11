import { TenantId } from '@radar/kernel';
import { describe, expect, it, vi } from 'vitest';
import { DigestScheduler } from '../../infra/schedulers/digest-scheduler.js';
import type { EnviarDigestUseCase } from '../../application/use-cases/enviar-digest.js';
import { UsuarioId } from '../../domain/entities/notificacao.js';

describe('DigestScheduler', () => {
  it('executa o ciclo por destinatario com janela calculada e repassa AbortSignal', async () => {
    const signal = new AbortController().signal;
    const agora = new Date('2026-07-05T12:00:00.000Z');
    const executar = vi.fn().mockResolvedValue({ enviados: 1, agrupados: 3 });
    const scheduler = new DigestScheduler(
      { executar } as Pick<EnviarDigestUseCase, 'executar'>,
      {
        destinatarios: [
          {
            usuarioId: UsuarioId('usuario-1'),
            tenantId: TenantId('tenant-a'),
            emailDestinatario: 'u1@example.com',
          },
          {
            usuarioId: UsuarioId('usuario-2'),
            tenantId: TenantId('tenant-b'),
            emailDestinatario: 'u2@example.com',
          },
        ],
        intervaloMs: 24 * 60 * 60 * 1000,
        tamanhoJanelaMs: 24 * 60 * 60 * 1000,
        agora: () => agora,
      },
    );

    const resultados = await scheduler.executarCiclo(signal);

    expect(executar).toHaveBeenCalledTimes(2);
    expect(executar).toHaveBeenNthCalledWith(
      1,
      {
        usuarioId: 'usuario-1',
        tenantId: 'tenant-a',
        emailDestinatario: 'u1@example.com',
        janela: { inicio: new Date('2026-07-04T12:00:00.000Z') },
      },
      signal,
    );
    expect(executar).toHaveBeenNthCalledWith(
      2,
      {
        usuarioId: 'usuario-2',
        tenantId: 'tenant-b',
        emailDestinatario: 'u2@example.com',
        janela: { inicio: new Date('2026-07-04T12:00:00.000Z') },
      },
      signal,
    );
    expect(resultados).toEqual([
      { enviados: 1, agrupados: 3 },
      { enviados: 1, agrupados: 3 },
    ]);
  });

  it('nao chama o use case quando o signal ja esta abortado', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const executar = vi.fn();
    const scheduler = new DigestScheduler(
      { executar } as Pick<EnviarDigestUseCase, 'executar'>,
      {
        destinatarios: [
          {
            usuarioId: UsuarioId('usuario-1'),
            tenantId: TenantId('tenant-a'),
            emailDestinatario: 'u1@example.com',
          },
        ],
        intervaloMs: 24 * 60 * 60 * 1000,
        tamanhoJanelaMs: 24 * 60 * 60 * 1000,
        agora: () => new Date('2026-07-05T12:00:00.000Z'),
      },
    );

    await expect(scheduler.executarCiclo(ctrl.signal)).rejects.toThrow();
    expect(executar).not.toHaveBeenCalled();
  });
});
