import { describe, expect, it } from 'vitest';
import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { PrazoCritico } from '../../domain/value-objects/prazo-critico.js';

const base = {
  id: AlertaId('alerta-001'),
  tenantId: TenantId('tenant-a'),
  clienteFinalId: ClienteFinalId('cliente-001'),
  criterioId: CriterioId('crit-001'),
  editalId: EditalId('edital-001'),
  aderencia: AderenciaMatching.criar(0.75),
  prazoCritico: PrazoCritico.calcular(null, new Date('2026-07-12')),
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
      expect(a.prazoCritico).toBe(base.prazoCritico);
    });
  });

  describe('imediato (P-81, A18 §5.1) — aderência alta OU prazo crítico', () => {
    it('é imediato quando a aderência é alta, mesmo sem prazo crítico', () => {
      const a = Alerta.criar({
        ...base,
        aderencia: AderenciaMatching.criar(0.9),
        prazoCritico: PrazoCritico.calcular(null, new Date('2026-07-12')),
      });
      expect(a.imediato).toBe(true);
    });

    it('é imediato quando o prazo é crítico, independentemente da aderência baixa', () => {
      const agora = new Date('2026-07-12T00:00:00.000Z');
      const prazoEm2Dias = new Date('2026-07-14T00:00:00.000Z');
      const a = Alerta.criar({
        ...base,
        aderencia: AderenciaMatching.criar(0.3),
        prazoCritico: PrazoCritico.calcular(prazoEm2Dias, agora),
      });
      expect(a.imediato).toBe(true);
    });

    it('não é imediato quando a aderência é baixa e o prazo não é crítico', () => {
      const a = Alerta.criar({
        ...base,
        aderencia: AderenciaMatching.criar(0.3),
        prazoCritico: PrazoCritico.calcular(null, new Date('2026-07-12')),
      });
      expect(a.imediato).toBe(false);
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
      expect(atualizado.prazoCritico).toBe(original.prazoCritico);
    });
  });
});
