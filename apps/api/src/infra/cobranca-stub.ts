/**
 * Stub em memória de AssinaturaRepository — substituir por PostgresAssinaturaRepository
 * (`@radar/cobranca/infra`) quando o Postgres de Cobrança for provisionado.
 *
 * Provisiona, sob demanda, uma assinatura `ativa` com cota generosa para qualquer
 * tenant autenticado — o contrato HTTP do gate (402/403) é verificável via testes
 * dedicados (entitlement.test.ts) contra dependências mockadas; este stub só evita
 * que o gate bloqueie o caminho de dev/demo antes do DB existir (mesma filosofia dos
 * demais stubs deste composition root, ver matching-stub.ts).
 *
 * `reservarCota`/`liberarReserva` fazem a mutação em um trecho síncrono (sem
 * `await` entre leitura e escrita) — Node é single-threaded, então chamadas
 * concorrentes não intercalam dentro do método, replicando a mesma semântica de
 * atomicidade do UPDATE real (provada contra Postgres em tests/bdd/features/cobranca).
 */

import { Assinatura, CicloDeFaturamento, PlanoComercial } from '@radar/cobranca';
import type { AssinaturaRepository } from '@radar/cobranca';
import type { TenantId } from '@radar/kernel';

const COTA_STUB_PADRAO = 1000;
const INICIO_CICLO_STUB = new Date('2026-01-01T00:00:00.000Z');
const FIM_CICLO_STUB = new Date('2126-01-01T00:00:00.000Z'); // stub não renova ciclo

export class InMemoriaAssinaturaRepository implements AssinaturaRepository {
  private readonly porTenant = new Map<TenantId, Assinatura>();

  constructor(private readonly cotaPadrao: number = COTA_STUB_PADRAO) {}

  private obterOuProvisionar(tenantId: TenantId): Assinatura {
    const existente = this.porTenant.get(tenantId);
    if (existente) return existente;

    const plano = PlanoComercial.criar({
      codigo: 'pro',
      cotaTriagensMes: this.cotaPadrao,
      precoCentavos: 0,
    });
    const ciclo = CicloDeFaturamento.criar(INICIO_CICLO_STUB, FIM_CICLO_STUB);
    const provisionada = Assinatura.iniciarTrial(tenantId, plano, ciclo).ativar('stub-sem-gateway');
    this.porTenant.set(tenantId, provisionada);
    return provisionada;
  }

  async reservarCota(tenantId: TenantId, _signal: AbortSignal): Promise<boolean> {
    const atual = this.obterOuProvisionar(tenantId);
    if (atual.estado !== 'ativa' && atual.estado !== 'trial') return false;
    if (atual.usoReservado >= atual.plano.cota.valor) return false;
    this.porTenant.set(tenantId, Assinatura.criar({ ...atual, usoReservado: atual.usoReservado + 1 }));
    return true;
  }

  async liberarReserva(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(
      tenantId,
      Assinatura.criar({ ...atual, usoReservado: Math.max(atual.usoReservado - 1, 0) }),
    );
  }

  /** Converte 1 unidade de reserva em uso confirmado (RAD-247) — fora do escopo do gate, só para satisfazer a interface. */
  async confirmarUso(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(
      tenantId,
      Assinatura.criar({
        ...atual,
        usoReservado: Math.max(atual.usoReservado - 1, 0),
        usoConfirmado: atual.usoConfirmado + 1,
      }),
    );
  }

  async porTenantId(tenantId: TenantId, _signal: AbortSignal): Promise<Assinatura | null> {
    return this.porTenant.get(tenantId) ?? null;
  }

  /** Mapeamento do webhook (RAD-250) — fora do escopo do gate, só para satisfazer a interface. */
  async porAssinaturaExternaId(assinaturaExternaId: string, _signal: AbortSignal): Promise<Assinatura | null> {
    for (const assinatura of this.porTenant.values()) {
      if (assinatura.assinaturaExternaId === assinaturaExternaId) return assinatura;
    }
    return null;
  }

  async salvar(assinatura: Assinatura, _signal: AbortSignal): Promise<void> {
    this.porTenant.set(assinatura.tenantId, assinatura);
  }
}

export const assinaturaStub: AssinaturaRepository = new InMemoriaAssinaturaRepository();
