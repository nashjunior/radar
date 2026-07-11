import { TenantId } from '@radar/kernel';
import { describe, expect, it, vi } from 'vitest';
import { DigestScheduler } from '../../infra/schedulers/digest-scheduler.js';
import type { EnviarDigestUseCase } from '../../application/use-cases/enviar-digest.js';
import { UsuarioId } from '../../domain/entities/notificacao.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const SEMANA_MS = 7 * DIA_MS;

describe('DigestScheduler', () => {
  describe('executarCiclo — ciclos DIARIA e SEMANAL independentes (RAD-207 §7)', () => {
    it('usa a janela de 24h e os destinatarios do ciclo DIARIA', async () => {
      const agora = new Date('2026-07-05T12:00:00.000Z');
      const executar = vi.fn().mockResolvedValue({ enviados: 1, agrupados: 0, total: 1 });
      const scheduler = new DigestScheduler(
        { executar } as Pick<EnviarDigestUseCase, 'executar'>,
        {
          ciclos: {
            DIARIA: {
              destinatarios: [
                {
                  usuarioId: UsuarioId('usuario-1'),
                  tenantId: TenantId('tenant-a'),
                  emailDestinatario: 'u1@example.com',
                },
              ],
              intervaloMs: DIA_MS,
              tamanhoJanelaMs: DIA_MS,
            },
            SEMANAL: {
              destinatarios: [],
              intervaloMs: SEMANA_MS,
              tamanhoJanelaMs: SEMANA_MS,
            },
          },
          agora: () => agora,
        },
      );

      const resultados = await scheduler.executarCiclo('DIARIA', new AbortController().signal);

      expect(executar).toHaveBeenCalledOnce();
      expect(executar).toHaveBeenCalledWith(
        {
          usuarioId: 'usuario-1',
          tenantId: 'tenant-a',
          emailDestinatario: 'u1@example.com',
          janela: { inicio: new Date('2026-07-04T12:00:00.000Z') },
        },
        expect.anything(),
      );
      expect(resultados).toEqual([{ enviados: 1, agrupados: 0, total: 1 }]);
    });

    it('usa a janela de 7 dias e os destinatarios do ciclo SEMANAL — não a janela do ciclo DIARIA', async () => {
      const agora = new Date('2026-07-05T12:00:00.000Z');
      const executar = vi.fn().mockResolvedValue({ enviados: 2, agrupados: 5, total: 7 });
      const scheduler = new DigestScheduler(
        { executar } as Pick<EnviarDigestUseCase, 'executar'>,
        {
          ciclos: {
            DIARIA: {
              destinatarios: [],
              intervaloMs: DIA_MS,
              tamanhoJanelaMs: DIA_MS,
            },
            SEMANAL: {
              destinatarios: [
                {
                  usuarioId: UsuarioId('usuario-2'),
                  tenantId: TenantId('tenant-b'),
                  emailDestinatario: 'u2@example.com',
                },
              ],
              intervaloMs: SEMANA_MS,
              tamanhoJanelaMs: SEMANA_MS,
            },
          },
          agora: () => agora,
        },
      );

      const resultados = await scheduler.executarCiclo('SEMANAL', new AbortController().signal);

      expect(executar).toHaveBeenCalledOnce();
      expect(executar).toHaveBeenCalledWith(
        {
          usuarioId: 'usuario-2',
          tenantId: 'tenant-b',
          emailDestinatario: 'u2@example.com',
          janela: { inicio: new Date('2026-06-28T12:00:00.000Z') },
        },
        expect.anything(),
      );
      expect(resultados).toEqual([{ enviados: 2, agrupados: 5, total: 7 }]);
    });

    it('nao chama o use case quando o signal ja esta abortado', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const executar = vi.fn();
      const scheduler = new DigestScheduler(
        { executar } as Pick<EnviarDigestUseCase, 'executar'>,
        {
          ciclos: {
            DIARIA: {
              destinatarios: [
                {
                  usuarioId: UsuarioId('usuario-1'),
                  tenantId: TenantId('tenant-a'),
                  emailDestinatario: 'u1@example.com',
                },
              ],
              intervaloMs: DIA_MS,
              tamanhoJanelaMs: DIA_MS,
            },
            SEMANAL: { destinatarios: [], intervaloMs: SEMANA_MS, tamanhoJanelaMs: SEMANA_MS },
          },
          agora: () => new Date('2026-07-05T12:00:00.000Z'),
        },
      );

      await expect(scheduler.executarCiclo('DIARIA', ctrl.signal)).rejects.toThrow();
      expect(executar).not.toHaveBeenCalled();
    });
  });

  describe('iniciar — dois timers independentes', () => {
    it('agenda um interval por ciclo e a funcao de parada limpa ambos', () => {
      vi.useFakeTimers();
      try {
        const executar = vi.fn().mockResolvedValue({ enviados: 0, agrupados: 0, total: 0 });
        const scheduler = new DigestScheduler(
          { executar } as Pick<EnviarDigestUseCase, 'executar'>,
          {
            ciclos: {
              DIARIA: { destinatarios: [], intervaloMs: DIA_MS, tamanhoJanelaMs: DIA_MS },
              SEMANAL: { destinatarios: [], intervaloMs: SEMANA_MS, tamanhoJanelaMs: SEMANA_MS },
            },
            agora: () => new Date('2026-07-05T12:00:00.000Z'),
          },
        );

        const parar = scheduler.iniciar(new AbortController().signal);
        expect(vi.getTimerCount()).toBe(2);

        parar();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
