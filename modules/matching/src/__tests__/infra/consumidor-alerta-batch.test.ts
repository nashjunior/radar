import { describe, expect, it, vi } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { ConsumidorAlertaBatch } from '../../infra/queue/consumidor-alerta-batch.js';
import { FilaAlertaMemoria } from '../../infra/adapters/fila-alerta-memoria.js';
import type { AlertaParaGravarPayload, AlertaRepository, EventPublisher } from '../../application/ports.js';
import type { Alerta } from '../../domain/entities/alerta.js';

const noop = new AbortController().signal;

function fazerPayload(i: number): AlertaParaGravarPayload {
  return {
    alertaId: AlertaId(`alerta-${i}`),
    tenantId: TenantId('tenant-a'),
    clienteFinalId: ClienteFinalId(`cliente-${i}`),
    criterioId: CriterioId(`criterio-${i}`),
    editalId: EditalId('edital-001'),
    aderencia: 0.8,
  };
}

function mockAlertaRepo(): AlertaRepository {
  return {
    salvar: vi.fn().mockResolvedValue(undefined),
    salvarEmLote: vi.fn().mockResolvedValue(undefined),
    porId: vi.fn(),
    atualizarFeedback: vi.fn(),
    listarPorTenant: vi.fn(),
  };
}

function mockEventPublisher(): EventPublisher {
  return { publicar: vi.fn().mockResolvedValue(undefined) };
}

// P-41/RAD-179 — prova central: 1 conexão (salvarEmLote) grava N linhas
describe('ConsumidorAlertaBatch', () => {
  describe('batch INSERT (P-41)', () => {
    it('chama salvarEmLote UMA VEZ com todos os alertas da fila — não N inserts individuais', async () => {
      const fila = new FilaAlertaMemoria();
      const N = 5;
      for (let i = 0; i < N; i++) {
        await fila.enfileirar(fazerPayload(i), noop);
      }

      const repo = mockAlertaRepo();
      const eventos = mockEventPublisher();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, eventos);

      const processados = await consumidor.processarLote(noop);

      expect(processados).toBe(N);
      // 1 chamada ao banco para N linhas — prova que não há N conexões
      expect(repo.salvarEmLote).toHaveBeenCalledOnce();
      expect(repo.salvar).not.toHaveBeenCalled();

      const [alertasGravados] = (repo.salvarEmLote as ReturnType<typeof vi.fn>).mock.calls[0] as [Alerta[]];
      expect(alertasGravados).toHaveLength(N);
    });

    it('publica AlertaGerado para cada alerta APÓS o batch INSERT', async () => {
      const fila = new FilaAlertaMemoria();
      const N = 3;
      for (let i = 0; i < N; i++) await fila.enfileirar(fazerPayload(i), noop);

      const repo = mockAlertaRepo();
      const eventos = mockEventPublisher();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, eventos);

      await consumidor.processarLote(noop);

      // INSERT deve ter ocorrido antes dos eventos
      const salvarOrder = (repo.salvarEmLote as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
      const primeiroEventoOrder = (eventos.publicar as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
      expect(salvarOrder).toBeLessThan(primeiroEventoOrder);

      expect(eventos.publicar).toHaveBeenCalledTimes(N);
      const tipos = (eventos.publicar as ReturnType<typeof vi.fn>).mock.calls.map(
        (args: unknown[]) => (args[0] as { type: string }).type,
      );
      expect(tipos.every((t: string) => t === 'alerta.gerado')).toBe(true);
    });

    it('respeita limite do lote — drena no máximo `tamanhoDeLote` itens por chamada', async () => {
      const fila = new FilaAlertaMemoria();
      for (let i = 0; i < 10; i++) await fila.enfileirar(fazerPayload(i), noop);

      const repo = mockAlertaRepo();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, mockEventPublisher());

      const processados = await consumidor.processarLote(noop, 4);

      expect(processados).toBe(4);
      expect(fila.tamanho).toBe(6);
      const [lote] = (repo.salvarEmLote as ReturnType<typeof vi.fn>).mock.calls[0] as [Alerta[]];
      expect(lote).toHaveLength(4);
    });
  });

  describe('fila vazia', () => {
    it('retorna 0 e não chama o repositório quando a fila está vazia', async () => {
      const fila = new FilaAlertaMemoria();
      const repo = mockAlertaRepo();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, mockEventPublisher());

      const processados = await consumidor.processarLote(noop);

      expect(processados).toBe(0);
      expect(repo.salvarEmLote).not.toHaveBeenCalled();
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('propaga signal ao repo e ao publisher', async () => {
      const ac = new AbortController();
      const fila = new FilaAlertaMemoria();
      await fila.enfileirar(fazerPayload(0), noop);

      const repo = mockAlertaRepo();
      const eventos = mockEventPublisher();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, eventos);

      await consumidor.processarLote(ac.signal);

      const [, repoSignal] = (repo.salvarEmLote as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, AbortSignal];
      expect(repoSignal).toBe(ac.signal);

      const [, evSignal] = (eventos.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, AbortSignal];
      expect(evSignal).toBe(ac.signal);
    });
  });

  describe('idempotência no payload', () => {
    it('reconstrói Alerta com os IDs corretos a partir do payload enfileirado', async () => {
      const fila = new FilaAlertaMemoria();
      const payload = fazerPayload(42);
      await fila.enfileirar(payload, noop);

      const repo = mockAlertaRepo();
      const consumidor = new ConsumidorAlertaBatch(fila, repo, mockEventPublisher());
      await consumidor.processarLote(noop);

      const [alertas] = (repo.salvarEmLote as ReturnType<typeof vi.fn>).mock.calls[0] as [Alerta[]];
      const alerta = alertas[0]!;
      expect(alerta.id).toBe(payload.alertaId);
      expect(alerta.tenantId).toBe(payload.tenantId);
      expect(alerta.clienteFinalId).toBe(payload.clienteFinalId);
      expect(alerta.aderencia.valor).toBe(payload.aderencia);
    });
  });
});
