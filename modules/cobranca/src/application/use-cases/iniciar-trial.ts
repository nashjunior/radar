import type { TenantId } from '@radar/kernel';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import type { AssinaturaRepository, ClockProvider } from '../ports.js';

export interface IniciarTrialInput {
  tenantId: TenantId;
}

/** Cota vitalícia do trial — 5 triagens em 14 dias, sem renovação (P-109 L0, RAD-269, docs/09 §6.1). */
const TRIAL_COTA_TRIAGENS = 5;
const TRIAL_DIAS = 14;
const TRIAL_MS = TRIAL_DIAS * 24 * 60 * 60 * 1000;

/**
 * Inicia o trial de um Tenant recém-provisionado — consumidor de
 * `organizacao.provisionada` (RAD-285): Cobrança é downstream de Identidade &
 * Organização (docs/13 §4), nunca a chama diretamente.
 *
 * "Vitalícia, sem renovação" é garantido pelo domínio, não por este use case:
 * `Assinatura.renovarCiclo` exige `estado === 'ativa'`, então um trial nunca
 * ganha um 2º ciclo de cota (P-109 L0).
 *
 * Idempotente por `tenantId` (SQS é at-least-once, o evento pode reentregar):
 * já existir uma Assinatura é no-op — nunca sobrescreve um trial em andamento
 * nem uma assinatura já convertida/paga.
 */
export class IniciarTrialUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly clock: ClockProvider,
  ) {}

  async executar(input: IniciarTrialInput, signal: AbortSignal): Promise<void> {
    const existente = await this.assinaturas.porTenantId(input.tenantId, signal);
    if (existente) return;

    const inicio = this.clock.agora();
    const fim = new Date(inicio.getTime() + TRIAL_MS);
    const plano = PlanoComercial.criar({
      codigo: 'trial',
      cotaTriagensMes: TRIAL_COTA_TRIAGENS,
      precoCentavos: 0,
    });
    const ciclo = CicloDeFaturamento.criar(inicio, fim);

    await this.assinaturas.salvar(Assinatura.iniciarTrial(input.tenantId, plano, ciclo), signal);
  }
}
