import { describe, expect, it } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { CriterioInvalidoError } from '../../domain/errors/index.js';

const base = {
  id: CriterioId('crit-001'),
  tenantId: TenantId('tenant-a'),
  clienteFinalId: ClienteFinalId('cliente-001'),
};

describe('CriterioDeMonitoramento', () => {
  describe('criar', () => {
    it('cria critério com ramo CNAE', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.ramoCnae).toBe('62.01');
      expect(c.ativo).toBe(true);
    });

    it('cria critério com palavras-chave', () => {
      const pc = PalavrasChave.criar(['software', 'ti']);
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: pc });
      expect(c.palavrasChave).toBe(pc);
    });

    it('cria critério com ambos (ramo + palavras-chave)', () => {
      const pc = PalavrasChave.criar(['cloud']);
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01', palavrasChave: pc });
      expect(c.ramoCnae).toBe('62.01');
      expect(c.palavrasChave).toBe(pc);
    });

    it('lança CriterioInvalidoError sem ramo nem palavras-chave', () => {
      expect(() => CriterioDeMonitoramento.criar({ ...base })).toThrow(CriterioInvalidoError);
    });

    it('o erro tem code CRITERIO_INVALIDO', () => {
      try {
        CriterioDeMonitoramento.criar({ ...base });
      } catch (e) {
        expect((e as CriterioInvalidoError).code).toBe('CRITERIO_INVALIDO');
      }
    });

    it('preserva tenantId e clienteFinalId', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.tenantId).toBe(base.tenantId);
      expect(c.clienteFinalId).toBe(base.clienteFinalId);
    });

    it('campos opcionais ausentes ficam null', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.regiaoUf).toBeNull();
      expect(c.faixaValor).toBeNull();
      expect(c.palavrasChave).toBeNull();
    });

    it('critério novo começa ativo', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.ativo).toBe(true);
    });
  });

  describe('reconstituir', () => {
    it('permite reconstituir com ativo = false (estado de persistência)', () => {
      const c = CriterioDeMonitoramento.reconstituir({ ...base, ramoCnae: '62.01', ativo: false });
      expect(c.ativo).toBe(false);
    });

    it('não valida invariantes de criação — aceita critério sem ramo nem palavras-chave', () => {
      expect(() =>
        CriterioDeMonitoramento.reconstituir({ ...base, ativo: true }),
      ).not.toThrow();
    });
  });
});
