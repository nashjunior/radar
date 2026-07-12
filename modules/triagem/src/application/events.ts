import type { ClienteFinalId, DomainEvent, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { Recomendacao } from '../domain/triagem.js';

export type { DomainEvent };

/**
 * Comando publicado por `SolicitarTriagemUseCase` (API) → consumido pelo worker `TriarEditalUseCase`
 * (A03 §§1,3; A17 §8). Payload enxuto; a triagem é assíncrona (custo/latência). `tenantId` sempre
 * presente, mesmo no MVP single-tenant (A01 §6). `coorteTrial` (RAD-271, P-109 L1): a assinatura do
 * tenant estava em `trial` no momento da solicitação — resolvido no BFF (que já consulta a Cobrança
 * no gate de cota), carregado até `TriarEditalUseCase` sem a Triagem importar `modules/cobranca`.
 */
export class TriagemSolicitada implements DomainEvent {
  readonly type = 'triagem.solicitada' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly usuarioId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly coorteTrial: boolean;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Published Language (A17 §8): emitido por `TriarEditalUseCase` → API/front (e Gestão da
 * Participação no *Next*). Carrega `riscos` (distinto do read DTO síncrono, que os projeta em
 * `checklist.ok:false` — docs/98 P-86).
 */
export class TriagemConcluida implements DomainEvent {
  readonly type = 'triagem.concluida' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly confianca: number;
      readonly aderencia: number;
      readonly recomendacao: Recomendacao;
      readonly riscos: readonly string[];
      /** `occurredAt` de `triagem.solicitada` — origem do SLO de latência (docs/08 §4.1, A18 §5). */
      readonly solicitadaEm?: Date;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Published Language (RAD-255): emitido por `TriarEditalUseCase` em todo caminho de falha/timeout/
 * cancelamento (worker e DLQ) → consumido por Cobrança para liberar a reserva de cota (P-107 (c),
 * docs/13 §3, tabela Reserva × RegistroDeUso). Mesma quádrupla de idempotência de `triagem.concluida`.
 * `motivo` é o `code` estável de `DomainError` (curto) — nunca stack trace, mensagem interna ou PII.
 */
export class TriagemFalhou implements DomainEvent {
  readonly type = 'triagem.falhou' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly motivo: string;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Published Language (RAD-81): usuário aceitou a análise — UTI1 (aceitação). */
export class TriagemAceita implements DomainEvent {
  readonly type = 'triagem.aceita' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Published Language (RAD-81): usuário contestou a análise — UTI1 (rejeição). */
export class TriagemContestada implements DomainEvent {
  readonly type = 'triagem.contestada' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly motivo: string | null;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/** Published Language (RAD-81): usuário registrou decisão go/no-go — UTI2 (conversão). */
export class TriagemDecisao implements DomainEvent {
  readonly type = 'triagem.decisao' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly tenantId: TenantId;
      readonly clienteFinalId: ClienteFinalId;
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly go: boolean;
    },
  ) {
    this.occurredAt = new Date();
  }
}

/**
 * Evento INTERNO ao contexto (A17 §8) — não é Published Language cross-context. Aquece o cache de
 * extração por edital (P-45); consumidores intra-contexto apenas.
 */
export class ExtracaoConcluida implements DomainEvent {
  readonly type = 'extracao.concluida' as const;
  readonly occurredAt: Date;

  constructor(
    readonly payload: {
      readonly editalId: EditalId;
      readonly confianca: number;
    },
  ) {
    this.occurredAt = new Date();
  }
}
