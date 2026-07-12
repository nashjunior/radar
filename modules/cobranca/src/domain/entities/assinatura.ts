import type { TenantId } from '@radar/kernel';
import { CicloDeFaturamento } from '../value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../value-objects/plano-comercial.js';
import { AssinaturaInativaError, CotaExcedidaError } from '../errors/index.js';

export type EstadoAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

export interface CriarAssinaturaProps {
  tenantId: TenantId;
  estado: EstadoAssinatura;
  plano: PlanoComercial;
  cicloVigente: CicloDeFaturamento;
  usoReservado: number;
  usoConfirmado: number;
  /** ID opaco do gateway de pagamento (P-107 (7)) — nunca dado do cliente final. */
  assinaturaExternaId: string | null;
}

/**
 * Agregado raiz do contexto Cobrança & Assinatura (docs/13 §3; P-107). Chaveado por
 * `tenantId` — único Shared Kernel, sem ID sintético próprio (mesmo padrão de
 * `AtribuicaoPapel` em Identidade & Organização; **um plano por Tenant no MVP**).
 *
 * `usoReservado` ≠ `usoConfirmado` (docs/12 ERD): reserva é *gate* — mutada por
 * `AssinaturaRepository.reservarCota`, um UPDATE atômico na borda que não passa por
 * este agregado (P-107 (3)) — e confirmação é *fatura*, mutada pelo consumidor de
 * `triagem.concluida` (RAD-247). Este agregado governa só o *ciclo de vida
 * comercial* (trial/ativa/inadimplente/suspensa/cancelada) — a política é nossa,
 * nunca do gateway (P-107 (6)).
 */
export class Assinatura {
  private constructor(
    readonly tenantId: TenantId,
    readonly estado: EstadoAssinatura,
    readonly plano: PlanoComercial,
    readonly cicloVigente: CicloDeFaturamento,
    readonly usoReservado: number,
    readonly usoConfirmado: number,
    readonly assinaturaExternaId: string | null,
  ) {}

  /** Reconstrução/validação a partir de estado já persistido — não é o ponto de entrada de um novo tenant (ver `iniciarTrial`). */
  static criar(props: CriarAssinaturaProps): Assinatura {
    if (props.usoReservado > props.plano.cota.valor) {
      throw new CotaExcedidaError(props.tenantId, props.usoReservado, props.plano.cota.valor);
    }
    return new Assinatura(
      props.tenantId,
      props.estado,
      props.plano,
      props.cicloVigente,
      props.usoReservado,
      props.usoConfirmado,
      props.assinaturaExternaId,
    );
  }

  /** Novo tenant: trial de 14 dias sem cartão (P-107 (9)), sem `assinaturaExternaId` (ainda não passou pelo checkout). */
  static iniciarTrial(tenantId: TenantId, plano: PlanoComercial, cicloVigente: CicloDeFaturamento): Assinatura {
    return new Assinatura(tenantId, 'trial', plano, cicloVigente, 0, 0, null);
  }

  /** `trial|inadimplente|suspensa → ativa` — ativação só no webhook `invoice.paid` (P-107 (6)), nunca no retorno do checkout. */
  ativar(assinaturaExternaId: string): Assinatura {
    if (this.estado === 'cancelada') throw new AssinaturaInativaError(this.tenantId, this.estado);
    return this.comEstado('ativa', assinaturaExternaId);
  }

  /** `ativa → inadimplente` — início da carência/dunning (P-107 (6)). */
  marcarInadimplente(): Assinatura {
    if (this.estado !== 'ativa') throw new AssinaturaInativaError(this.tenantId, this.estado);
    return this.comEstado('inadimplente');
  }

  /** `ativa|inadimplente → suspensa` — carência expirada ou suspensão direta. */
  suspender(): Assinatura {
    if (this.estado === 'cancelada') throw new AssinaturaInativaError(this.tenantId, this.estado);
    return this.comEstado('suspensa');
  }

  /** Qualquer estado não-terminal `→ cancelada`. Terminal: cancelar de novo é erro, não no-op. */
  cancelar(): Assinatura {
    if (this.estado === 'cancelada') throw new AssinaturaInativaError(this.tenantId, this.estado);
    return this.comEstado('cancelada');
  }

  /** Rollover do ciclo de cobrança — só a partir de `ativa`; zera os contadores do período novo. */
  renovarCiclo(novoCiclo: CicloDeFaturamento): Assinatura {
    if (this.estado !== 'ativa') throw new AssinaturaInativaError(this.tenantId, this.estado);
    return new Assinatura(
      this.tenantId,
      this.estado,
      this.plano,
      novoCiclo,
      0,
      0,
      this.assinaturaExternaId,
    );
  }

  /**
   * Trial de 14 dias sem cartão (P-107 (9)) vencido sem conversão — avaliação
   * LAZY no gate/leitura, nunca por scheduler: o estado persistido continua
   * `trial` até o próximo `ativar`/`cancelar`, mas a política de acesso já trata
   * como inativa a partir de `cicloVigente.fim`.
   */
  trialVencido(agora: Date): boolean {
    return this.estado === 'trial' && agora >= this.cicloVigente.fim;
  }

  private comEstado(estado: EstadoAssinatura, assinaturaExternaId = this.assinaturaExternaId): Assinatura {
    return new Assinatura(
      this.tenantId,
      estado,
      this.plano,
      this.cicloVigente,
      this.usoReservado,
      this.usoConfirmado,
      assinaturaExternaId,
    );
  }
}
