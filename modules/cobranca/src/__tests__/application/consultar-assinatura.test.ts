import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { ConsultarAssinaturaUseCase } from '../../application/use-cases/consultar-assinatura.js';
import { Assinatura } from '../../domain/entities/assinatura.js';
import type { EstadoAssinatura } from '../../domain/entities/assinatura.js';
import { AssinaturaNaoEncontradaError } from '../../domain/errors/index.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const TENANT = TenantId('tenant-001');
const noop = new AbortController().signal;

const AGORA = new Date('2026-07-11T00:00:00Z');
const FIM_CICLO_8_DIAS = new Date('2026-07-19T00:00:00Z'); // AGORA + 8 dias

function assinaturaCom(estado: EstadoAssinatura, fimCiclo: Date) {
  return Assinatura.criar({
    tenantId: TENANT,
    estado,
    plano: PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 30, precoCentavos: 12900 }),
    cicloVigente: CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), fimCiclo),
    usoReservado: 5,
    usoConfirmado: 3,
    assinaturaExternaId: 'ext-1',
  });
}

function makeAssinaturas(assinatura: Assinatura | null) {
  return { porTenantId: vi.fn().mockResolvedValue(assinatura) } as any;
}

function makeClock(agora: Date) {
  return { agora: vi.fn(() => agora) };
}

describe('ConsultarAssinaturaUseCase', () => {
  it('lança AssinaturaNaoEncontradaError quando não há assinatura para o tenant', async () => {
    const uc = new ConsultarAssinaturaUseCase(makeAssinaturas(null), makeClock(AGORA));
    await expect(uc.executar({ tenantId: TENANT }, noop)).rejects.toThrow(AssinaturaNaoEncontradaError);
  });

  it.each<EstadoAssinatura>(['trial', 'ativa', 'inadimplente', 'suspensa'])(
    'projeta estado, plano e uso reservado/confirmado sem colapsar em "%s"',
    async (estado) => {
      const uc = new ConsultarAssinaturaUseCase(
        makeAssinaturas(assinaturaCom(estado, FIM_CICLO_8_DIAS)),
        makeClock(AGORA),
      );

      const dto = await uc.executar({ tenantId: TENANT }, noop);

      expect(dto.estado).toBe(estado);
      expect(dto.plano).toEqual({ codigo: 'starter', cota: 30 });
      expect(dto.usoReservado).toBe(5);
      expect(dto.usoConfirmado).toBe(3);
    },
  );

  it('trial: diasRestantes deriva de cicloVigente.fim ("8 dias restantes")', async () => {
    const uc = new ConsultarAssinaturaUseCase(
      makeAssinaturas(assinaturaCom('trial', FIM_CICLO_8_DIAS)),
      makeClock(AGORA),
    );

    const dto = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto.diasRestantes).toBe(8);
  });

  it('cancelada: diasRestantes é null (sem ciclo futuro a contar)', async () => {
    const uc = new ConsultarAssinaturaUseCase(
      makeAssinaturas(assinaturaCom('cancelada', FIM_CICLO_8_DIAS)),
      makeClock(AGORA),
    );

    const dto = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto.estado).toBe('cancelada');
    expect(dto.diasRestantes).toBeNull();
  });

  it('ciclo já vencido: diasRestantes nunca fica negativo', async () => {
    const cicloVencido = new Date('2026-07-05T00:00:00Z'); // antes de AGORA (2026-07-11), depois de inicio (2026-07-01)
    const uc = new ConsultarAssinaturaUseCase(
      makeAssinaturas(assinaturaCom('ativa', cicloVencido)),
      makeClock(AGORA),
    );

    const dto = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto.diasRestantes).toBe(0);
  });

  it('trial vencido (cicloVigente.fim no passado) projeta estado "suspensa" e diasRestantes 0 (RAD-277)', async () => {
    const cicloVencido = new Date('2026-07-05T00:00:00Z'); // antes de AGORA (2026-07-11)
    const uc = new ConsultarAssinaturaUseCase(
      makeAssinaturas(assinaturaCom('trial', cicloVencido)),
      makeClock(AGORA),
    );

    const dto = await uc.executar({ tenantId: TENANT }, noop);

    expect(dto.estado).toBe('suspensa');
    expect(dto.diasRestantes).toBe(0);
  });
});
