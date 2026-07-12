import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { AssinaturaInativaError, CotaExcedidaError } from '../../domain/errors/index.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const TENANT = TenantId('tenant-001');

const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 10, precoCentavos: 9900 });
const ciclo = CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));

describe('Assinatura', () => {
  describe('iniciarTrial', () => {
    it('cria assinatura em trial, sem uso e sem assinaturaExternaId', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(a.estado).toBe('trial');
      expect(a.usoReservado).toBe(0);
      expect(a.usoConfirmado).toBe(0);
      expect(a.assinaturaExternaId).toBeNull();
    });
  });

  describe('criar — invariante usoReservado <= cota', () => {
    it('aceita usoReservado igual à cota', () => {
      const a = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 10,
        usoConfirmado: 0,
        assinaturaExternaId: 'ext-1',
      });
      expect(a.usoReservado).toBe(10);
    });

    it('rejeita usoReservado maior que a cota', () => {
      expect(() =>
        Assinatura.criar({
          tenantId: TENANT,
          estado: 'ativa',
          plano,
          cicloVigente: ciclo,
          usoReservado: 11,
          usoConfirmado: 0,
          assinaturaExternaId: 'ext-1',
        }),
      ).toThrow(CotaExcedidaError);
    });
  });

  describe('transições de estado', () => {
    it('trial -> ativa via ativar, gravando assinaturaExternaId', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-42');
      expect(a.estado).toBe('ativa');
      expect(a.assinaturaExternaId).toBe('ext-42');
    });

    it('ativa -> inadimplente via marcarInadimplente', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1').marcarInadimplente();
      expect(a.estado).toBe('inadimplente');
    });

    it('rejeita marcarInadimplente fora de ativa', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(() => trial.marcarInadimplente()).toThrow(AssinaturaInativaError);
    });

    it('inadimplente -> suspensa via suspender', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo)
        .ativar('ext-1')
        .marcarInadimplente()
        .suspender();
      expect(a.estado).toBe('suspensa');
    });

    it('suspensa -> ativa via ativar (reativação)', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo)
        .ativar('ext-1')
        .marcarInadimplente()
        .suspender()
        .ativar('ext-1');
      expect(a.estado).toBe('ativa');
    });

    it('qualquer estado não-terminal -> cancelada', () => {
      const a = Assinatura.iniciarTrial(TENANT, plano, ciclo).cancelar();
      expect(a.estado).toBe('cancelada');
    });

    it('cancelar assinatura já cancelada lança AssinaturaInativaError', () => {
      const cancelada = Assinatura.iniciarTrial(TENANT, plano, ciclo).cancelar();
      expect(() => cancelada.cancelar()).toThrow(AssinaturaInativaError);
    });

    it('ativar assinatura cancelada lança AssinaturaInativaError', () => {
      const cancelada = Assinatura.iniciarTrial(TENANT, plano, ciclo).cancelar();
      expect(() => cancelada.ativar('ext-1')).toThrow(AssinaturaInativaError);
    });
  });

  describe('renovarCiclo', () => {
    const novoCiclo = CicloDeFaturamento.criar(new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));

    it('só permite renovação a partir de ativa', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(() => trial.renovarCiclo(novoCiclo)).toThrow(AssinaturaInativaError);
    });

    it('zera usoReservado e usoConfirmado e troca o ciclo vigente', () => {
      const ativa = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 7,
        usoConfirmado: 5,
        assinaturaExternaId: 'ext-1',
      });
      const renovada = ativa.renovarCiclo(novoCiclo);
      expect(renovada.usoReservado).toBe(0);
      expect(renovada.usoConfirmado).toBe(0);
      expect(renovada.cicloVigente).toBe(novoCiclo);
    });
  });

  describe('trialVencido — trial de 14 dias sem cartão (P-107 (9), RAD-277)', () => {
    it('false quando estado não é trial, mesmo com cicloVigente.fim no passado', () => {
      const ativa = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1');
      expect(ativa.trialVencido(new Date('2027-01-01T00:00:00Z'))).toBe(false);
    });

    it('false enquanto cicloVigente.fim ainda não chegou', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(trial.trialVencido(new Date('2026-07-15T00:00:00Z'))).toBe(false); // ciclo vai até 2026-08-01
    });

    it('true a partir de cicloVigente.fim (inclusive)', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(trial.trialVencido(ciclo.fim)).toBe(true);
      expect(trial.trialVencido(new Date('2026-08-02T00:00:00Z'))).toBe(true);
    });
  });

  it('mutações retornam nova instância — a original não muda', () => {
    const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
    const ativa = trial.ativar('ext-1');
    expect(trial.estado).toBe('trial');
    expect(ativa.estado).toBe('ativa');
    expect(ativa).not.toBe(trial);
  });
});
