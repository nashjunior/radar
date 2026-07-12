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

  describe('criar — invariante usoReservado <= teto', () => {
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

    it('aceita usoReservado acima da cota quando `ativa` — dívida do ciclo em carência (RAD-290)', () => {
      const a = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 15, // > cota (10), <= teto de carência (2x = 20)
        usoConfirmado: 0,
        assinaturaExternaId: 'ext-1',
      });
      expect(a.usoReservado).toBe(15);
    });

    it('rejeita usoReservado acima do teto de carência (2x a cota) quando `ativa`', () => {
      expect(() =>
        Assinatura.criar({
          tenantId: TENANT,
          estado: 'ativa',
          plano,
          cicloVigente: ciclo,
          usoReservado: 21, // > 2x cota (20)
          usoConfirmado: 0,
          assinaturaExternaId: 'ext-1',
        }),
      ).toThrow(CotaExcedidaError);
    });

    it('rejeita usoReservado maior que a cota quando `trial` — trial não entra em carência (P-109)', () => {
      expect(() =>
        Assinatura.criar({
          tenantId: TENANT,
          estado: 'trial',
          plano,
          cicloVigente: ciclo,
          usoReservado: 11,
          usoConfirmado: 0,
          assinaturaExternaId: null,
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

  describe('renovarSeVencido — renovação lazy do ciclo (RAD-287)', () => {
    it('não muda nada quando o ciclo ainda está vigente', () => {
      const ativa = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 3,
        usoConfirmado: 1,
        assinaturaExternaId: 'ext-1',
      });
      const resultado = ativa.renovarSeVencido(new Date('2026-07-15T00:00:00Z')); // ciclo vai até 2026-08-01
      expect(resultado).toBe(ativa);
    });

    it('renova quando o ciclo já venceu — zera contadores e avança 30 dias a partir do fim antigo', () => {
      const ativa = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 10,
        usoConfirmado: 10,
        assinaturaExternaId: 'ext-1',
      });
      const resultado = ativa.renovarSeVencido(new Date('2026-08-05T00:00:00Z')); // depois de ciclo.fim
      expect(resultado.usoReservado).toBe(0);
      expect(resultado.usoConfirmado).toBe(0);
      expect(resultado.cicloVigente.inicio).toEqual(ciclo.fim);
      expect(resultado.cicloVigente.fim).toEqual(new Date(ciclo.fim.getTime() + 30 * 24 * 60 * 60 * 1000));
    });

    it('vence no exato instante de cicloVigente.fim (inclusive)', () => {
      const ativa = Assinatura.criar({
        tenantId: TENANT,
        estado: 'ativa',
        plano,
        cicloVigente: ciclo,
        usoReservado: 10,
        usoConfirmado: 10,
        assinaturaExternaId: 'ext-1',
      });
      const resultado = ativa.renovarSeVencido(ciclo.fim);
      expect(resultado.usoReservado).toBe(0);
    });

    it('nunca renova trial — cota do trial é vitalícia, não mensal (P-109)', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      const resultado = trial.renovarSeVencido(new Date('2026-09-01T00:00:00Z')); // bem depois do fim do ciclo
      expect(resultado).toBe(trial);
      expect(resultado.estado).toBe('trial');
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

  describe('emCarencia — carência por tempo do ciclo `ativa` vencido (RAD-290)', () => {
    it('false quando o ciclo ainda está vigente', () => {
      const ativa = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1');
      expect(ativa.emCarencia(new Date('2026-07-15T00:00:00Z'))).toBe(false); // ciclo vai até 2026-08-01
    });

    it('true logo após o vencimento, dentro da janela de carência', () => {
      const ativa = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1');
      expect(ativa.emCarencia(new Date('2026-08-02T00:00:00Z'))).toBe(true); // 1 dia depois do fim
    });

    it('true no exato instante de cicloVigente.fim (inclusive)', () => {
      const ativa = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1');
      expect(ativa.emCarencia(ciclo.fim)).toBe(true);
    });

    it('false quando a carência expirou (fora da janela)', () => {
      const ativa = Assinatura.iniciarTrial(TENANT, plano, ciclo).ativar('ext-1');
      expect(ativa.emCarencia(new Date('2026-08-10T00:00:00Z'))).toBe(false); // 9 dias depois do fim
    });

    it('nunca entra em carência trial — cota do trial é vitalícia, não mensal (P-109)', () => {
      const trial = Assinatura.iniciarTrial(TENANT, plano, ciclo);
      expect(trial.emCarencia(new Date('2026-09-01T00:00:00Z'))).toBe(false);
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
