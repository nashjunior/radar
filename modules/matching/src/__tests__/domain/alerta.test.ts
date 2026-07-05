import { describe, expect, it } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';

const base = {
  id: AlertaId('alerta-001'),
  tenantId: TenantId('tenant-a'),
  clienteFinalId: ClienteFinalId('cliente-001'),
  criterioId: CriterioId('crit-001'),
  editalId: EditalId('edital-001'),
  aderencia: AderenciaMatching.criar(0.75),
};

describe('Alerta', () => {
  describe('criar', () => {
    it('cria alerta com relevante = null', () => {
      const a = Alerta.criar(base);
      expect(a.relevante).toBeNull();
    });

    it('preserva todos os campos de identidade', () => {
      const a = Alerta.criar(base);
      expect(a.id).toBe(base.id);
      expect(a.tenantId).toBe(base.tenantId);
      expect(a.clienteFinalId).toBe(base.clienteFinalId);
      expect(a.criterioId).toBe(base.criterioId);
      expect(a.editalId).toBe(base.editalId);
      expect(a.aderencia.valor).toBe(0.75);
    });
  });

  describe('comFeedback — imutabilidade', () => {
    it('retorna nova instância com relevante = true sem mutar o original', () => {
      const original = Alerta.criar(base);
      const atualizado = original.comFeedback(true);

      expect(atualizado.relevante).toBe(true);
      expect(original.relevante).toBeNull();
    });

    it('retorna nova instância com relevante = false', () => {
      const original = Alerta.criar(base);
      const atualizado = original.comFeedback(false);

      expect(atualizado.relevante).toBe(false);
      expect(original.relevante).toBeNull();
    });

    it('nova instância preserva todos os demais campos', () => {
      const original = Alerta.criar(base);
      const atualizado = original.comFeedback(true);

      expect(atualizado.id).toBe(original.id);
      expect(atualizado.tenantId).toBe(original.tenantId);
      expect(atualizado.clienteFinalId).toBe(original.clienteFinalId);
      expect(atualizado.criterioId).toBe(original.criterioId);
      expect(atualizado.editalId).toBe(original.editalId);
      expect(atualizado.aderencia).toBe(original.aderencia);
    });
  });
});
