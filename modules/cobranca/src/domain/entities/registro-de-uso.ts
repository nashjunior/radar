import type { ClienteFinalId, EditalId, PerfilId, RegistroDeUsoId, TenantId } from '@radar/kernel';

export interface CriarRegistroDeUsoProps {
  id: RegistroDeUsoId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  editalId: EditalId;
  perfilId: PerfilId;
  /** Período de faturamento, formato `AAAA-MM` — parte da chave natural (P-107 (4)). */
  periodo: string;
  confirmadoEm: Date;
}

/**
 * Entity do contexto Cobrança & Assinatura (docs/13 §3). A chave natural
 * `(tenantId, clienteFinalId, editalId, perfilId, periodo)` — `UNIQUE` na tabela
 * (RAD-245, migração 001) — é a chave de idempotência da fatura: o consumidor de
 * `triagem.concluida` recebe *at-least-once* do SQS e o `DomainEvent` não carrega
 * `eventId`, então dedupe é por `INSERT ... ON CONFLICT DO NOTHING` nessa chave
 * (P-107 (4)). Uma linha só nasce **confirmada** — nunca representa a reserva
 * (`Assinatura.usoReservado`, que vive só no agregado `Assinatura`).
 *
 * Distinta de `RegistroUsoLlm`/`UsoLlmLedger` (Triagem, RAD-230): contextos e
 * unidades diferentes — aqui a unidade é a triagem concluída faturável por tenant;
 * lá é a chamada de LLM, para medir custo nosso (docs/13 §3, nota de linguagem).
 */
export class RegistroDeUso {
  private constructor(
    readonly id: RegistroDeUsoId,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId,
    readonly editalId: EditalId,
    readonly perfilId: PerfilId,
    readonly periodo: string,
    readonly confirmadoEm: Date,
  ) {}

  static criar(props: CriarRegistroDeUsoProps): RegistroDeUso {
    return new RegistroDeUso(
      props.id,
      props.tenantId,
      props.clienteFinalId,
      props.editalId,
      props.perfilId,
      props.periodo,
      props.confirmadoEm,
    );
  }
}
