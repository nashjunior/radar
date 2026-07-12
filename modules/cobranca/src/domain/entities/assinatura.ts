import type { TenantId } from '@radar/kernel';
import { CicloDeFaturamento } from '../value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../value-objects/plano-comercial.js';
import { AssinaturaInativaError, CotaExcedidaError } from '../errors/index.js';

export type EstadoAssinatura = 'trial' | 'ativa' | 'inadimplente' | 'suspensa' | 'cancelada';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_CICLO_PADRAO = 30;
/**
 * [A VALIDAR] por Produto (docs/98 P-107) — placeholder conservador até o número
 * virar decisão de negócio (RAD-290). Duração da carência do ciclo `ativa`
 * vencido (ver `emCarencia`) — dias corridos após `cicloVigente.fim` em que o
 * gate ainda concede, dívida acima da cota, antes do próximo `invoice.paid`.
 */
const DIAS_CARENCIA_PADRAO = 3;
/**
 * [A VALIDAR] por Produto (docs/98 P-107) — placeholder conservador até o número
 * virar decisão de negócio (RAD-290). Teto do ciclo `ativa` em carência: o gate
 * (`PostgresAssinaturaRepository.reservarCota`) deixa `usoReservado` passar da
 * cota — de propósito, é dívida do ciclo vencido ainda não renovado por
 * `invoice.paid` — então `criar` precisa aceitar essa faixa ao reconstituir a
 * linha, em vez de tratá-la como corrupção de dado.
 */
const MULTIPLICADOR_TETO_CARENCIA = 2;

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

  /**
   * Reconstrução/validação a partir de estado já persistido — não é o ponto de
   * entrada de um novo tenant (ver `iniciarTrial`). Teto só dobra para `ativa`
   * (carência do ciclo vencido, RAD-290) — `trial` não renova (P-109), então
   * continua com o teto estrito na própria cota.
   */
  static criar(props: CriarAssinaturaProps): Assinatura {
    const teto =
      props.estado === 'ativa' ? props.plano.cota.valor * MULTIPLICADOR_TETO_CARENCIA : props.plano.cota.valor;
    if (props.usoReservado > teto) {
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

  /**
   * Carência do ciclo `ativa` vencido (RAD-290, corrige a tentativa de RAD-287 de
   * rolar `periodo_fim` no próprio gate) — mesmo padrão de `trialVencido`: projeção
   * pura, avaliada no gate, nunca escrita. `PostgresAssinaturaRepository.reservarCota`
   * duplica esta MESMA janela em SQL (não pode chamar este método, decide sob
   * concorrência sem carregar o agregado, P-107 (3)); esta função é a fonte da regra
   * para quem reconstitui o agregado (o `FakeAssinaturaRepository` de teste chama
   * este método em vez de reimplementar a aritmética).
   */
  emCarencia(agora: Date): boolean {
    if (this.estado !== 'ativa' || agora < this.cicloVigente.fim) return false;
    const fimCarencia = new Date(this.cicloVigente.fim.getTime() + DIAS_CARENCIA_PADRAO * MS_POR_DIA);
    return agora < fimCarencia;
  }

  /**
   * Renovação LAZY do ciclo (RAD-287) — mesmo padrão de `trialVencido`: projeção pura,
   * avaliada em leitura/gate, nunca escrita por um scheduler. Sem gatilho nenhum
   * chamava `renovarCiclo` fora do rollover do webhook `invoice.paid` (RAD-277, em
   * `ProcessarEventoDePagamentoUseCase`, que só dispara quando o Asaas confirma o
   * PRÓXIMO pagamento recorrente) — entre o vencimento do ciclo e essa confirmação
   * assíncrona, a cota ficava presa. Só `ativa` renova: trial tem cota vitalícia, não
   * mensal (P-109) — `renovarCiclo` já lança se chamado fora de `ativa`, então esta
   * função nem tenta. A janela de 30 dias corridos a partir do fim antigo é um placeholder
   * só até a confirmação do gateway chegar: quando `invoice.paid` chega, `renovarCiclo`
   * troca a instância de novo com a data autoritativa (`proximoVencimento` do Asaas) —
   * a duplicação da janela de 30 dias no UPDATE atômico de `PostgresAssinaturaRepository`
   * espelha esta MESMA regra, porque o SQL não pode chamar este método (decide sob
   * concorrência sem carregar o agregado, P-107 (3)).
   */
  renovarSeVencido(agora: Date): Assinatura {
    if (this.estado !== 'ativa' || agora < this.cicloVigente.fim) return this;
    const novoInicio = this.cicloVigente.fim;
    const novoFim = new Date(novoInicio.getTime() + DIAS_CICLO_PADRAO * MS_POR_DIA);
    return this.renovarCiclo(CicloDeFaturamento.criar(novoInicio, novoFim));
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
