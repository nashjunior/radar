import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { ConsultarMetricasMatchingUseCase } from '../../application/use-cases/consultar-metricas-matching.js';
import type { MetricaMatchingRepository } from '../../application/ports.js';

const noop = new AbortController().signal;
const tenantId = TenantId('tenant-a');

describe('ConsultarMetricasMatchingUseCase', () => {
  describe('precisão', () => {
    it('retorna ratio de relevantes/comFeedback quando há feedback', async () => {
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 7, comFeedback: 10 }),
        ativacao: vi.fn().mockResolvedValue({ ativados: 0, total: 0 }),
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId }, noop);

      expect(result.precisao).toBeCloseTo(0.7);
      expect(result.precisaoAlvo).toBe(0.6);
    });

    it('retorna null quando não há feedback algum', async () => {
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 0, comFeedback: 0 }),
        ativacao: vi.fn().mockResolvedValue({ ativados: 0, total: 0 }),
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId }, noop);

      expect(result.precisao).toBeNull();
    });
  });

  describe('ativação', () => {
    it('retorna ratio de ativados/total quando há dados', async () => {
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 0, comFeedback: 0 }),
        ativacao: vi.fn().mockResolvedValue({ ativados: 3, total: 5 }),
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId }, noop);

      expect(result.ativacao).toBeCloseTo(0.6);
      expect(result.ativacaoAlvo).toBe(0.5);
    });

    it('retorna null quando não há clientes com alertas na janela', async () => {
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 0, comFeedback: 0 }),
        ativacao: vi.fn().mockResolvedValue({ ativados: 0, total: 0 }),
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId }, noop);

      expect(result.ativacao).toBeNull();
    });
  });

  describe('janela de ativação', () => {
    it('usa 7 dias como default', async () => {
      const ativacao = vi.fn().mockResolvedValue({ ativados: 0, total: 0 });
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 0, comFeedback: 0 }),
        ativacao,
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId }, noop);

      expect(result.janelaEmDias).toBe(7);
      expect(ativacao).toHaveBeenCalledWith(tenantId, 7, noop);
    });

    it('usa janelaEmDias customizada quando fornecida', async () => {
      const ativacao = vi.fn().mockResolvedValue({ ativados: 1, total: 2 });
      const repo: MetricaMatchingRepository = {
        precisao: vi.fn().mockResolvedValue({ relevantes: 0, comFeedback: 0 }),
        ativacao,
      };
      const uc = new ConsultarMetricasMatchingUseCase(repo);
      const result = await uc.executar({ tenantId, janelaEmDias: 14 }, noop);

      expect(result.janelaEmDias).toBe(14);
      expect(ativacao).toHaveBeenCalledWith(tenantId, 14, noop);
    });
  });

  it('consulta precisão e ativação em paralelo', async () => {
    const order: string[] = [];
    const repo: MetricaMatchingRepository = {
      precisao: vi.fn().mockImplementation(async () => {
        order.push('precisao');
        return { relevantes: 0, comFeedback: 0 };
      }),
      ativacao: vi.fn().mockImplementation(async () => {
        order.push('ativacao');
        return { ativados: 0, total: 0 };
      }),
    };
    const uc = new ConsultarMetricasMatchingUseCase(repo);
    await uc.executar({ tenantId }, noop);

    expect(repo.precisao).toHaveBeenCalledOnce();
    expect(repo.ativacao).toHaveBeenCalledOnce();
  });
});
