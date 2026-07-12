import { DomainError } from '@radar/kernel';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { ConfirmarUsoUseCase } from '../../application/use-cases/confirmar-uso.js';
import type { LiberarReservaUseCase } from '../../application/use-cases/liberar-reserva.js';
import type { IniciarTrialUseCase } from '../../application/use-cases/iniciar-trial.js';

/** Contrato canônico de `triagem.concluida` que a Cobrança consome (arquitetura/03 §3). */
interface TriagemConcluidaMsg {
  tenantId: string;
  clienteFinalId: string;
  editalId: string;
  perfilId: string;
}

/** Contrato canônico de `triagem.falhou` que a Cobrança consome (RAD-248, arquitetura/03 §3). */
interface TriagemFalhouMsg {
  tenantId: string;
}

/**
 * Contrato canônico de `organizacao.provisionada` que a Cobrança consome (RAD-285,
 * arquitetura/03 §3) — publicado por Identidade & Organização. Só `tenantId` é
 * usado aqui; `sub` do payload real não é dado desta assinatura.
 */
interface OrganizacaoProvisionadaMsg {
  tenantId: string;
}

interface DlqClient {
  encaminhar(msg: TriagemConcluidaMsg, err: unknown): Promise<void>;
}

/**
 * Consumidor de `triagem.concluida`/`triagem.falhou`/`organizacao.provisionada`
 * (P-107, RAD-247, RAD-285) — Cobrança é downstream: nunca importa
 * `modules/triagem` nem `modules/identidade` (isolamento de bounded context,
 * docs/13 §4) — o contrato de cada evento é replicado aqui como DTO local, mesmo
 * padrão de `NotificacaoWorker` (`alerta.gerado`).
 */
export class CobrancaWorker {
  constructor(
    private readonly confirmarUsoUC: ConfirmarUsoUseCase,
    private readonly liberarReservaUC: LiberarReservaUseCase,
    private readonly dlq: DlqClient,
    private readonly iniciarTrialUC: IniciarTrialUseCase,
  ) {}

  /**
   * `DomainError` (ex.: `AssinaturaNaoEncontradaError`) → encaminha para DLQ sem
   * relançar — retry não resolve uma assinatura que não existe. Erro de
   * infraestrutura → relança (NACK, deixa o SQS reentregar).
   */
  async processarTriagemConcluida(msg: TriagemConcluidaMsg, signal: AbortSignal): Promise<void> {
    try {
      await this.confirmarUsoUC.executar(
        {
          tenantId: TenantId(msg.tenantId),
          clienteFinalId: ClienteFinalId(msg.clienteFinalId),
          editalId: EditalId(msg.editalId),
          perfilId: PerfilId(msg.perfilId),
          confirmadoEm: new Date(),
        },
        signal,
      );
    } catch (err) {
      if (err instanceof DomainError) {
        await this.dlq.encaminhar(msg, err);
        return;
      }
      throw err;
    }
  }

  /**
   * Mesmo ponto de entrada para a fila `triagem.falhou` e para o handler de DLQ
   * do worker de Triagem — mesmo formato de mensagem nos dois casos.
   * `liberarReserva` é idempotente (piso em zero), então não há necessidade de
   * uma segunda DLQ própria: um erro de infraestrutura relança e o SQS reentrega.
   *
   * FECHADO (RAD-259, arquitetura/03 §3): `TriarEditalUseCase` publica
   * `triagem.falhou` para todo erro capturado DENTRO de `executar()`. O worker
   * que consome `triagem.solicitada` → `TriarEditalUseCase` (`TriagemSolicitadaWorker`,
   * composto em `apps/api/src/workers.ts`) tem handler de DLQ dedicado (`processarDlq`)
   * para o caminho de erro de INFRA (crash, falha de rede ANTES de invocar `executar()`):
   * publica `triagem.falhou` com a chave natural da mensagem original antes de descartá-la,
   * então este método é sempre alcançado — DLQ dela inclusive.
   */
  async processarTriagemFalhou(msg: TriagemFalhouMsg, signal: AbortSignal): Promise<void> {
    await this.liberarReservaUC.executar({ tenantId: TenantId(msg.tenantId) }, signal);
  }

  /**
   * Consumidor de `organizacao.provisionada` (RAD-285) — inicia o trial do Tenant
   * recém-criado (P-109 L0/RAD-269). `IniciarTrialUseCase` já é idempotente por
   * `tenantId`, então reentrega (SQS at-least-once) é no-op; sem DLQ dedicada —
   * não há hoje um erro de domínio esperado neste caminho (só infra, que relança).
   */
  async processarOrganizacaoProvisionada(msg: OrganizacaoProvisionadaMsg, signal: AbortSignal): Promise<void> {
    await this.iniciarTrialUC.executar({ tenantId: TenantId(msg.tenantId) }, signal);
  }
}
