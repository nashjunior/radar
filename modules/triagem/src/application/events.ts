import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { Recomendacao } from '../domain/triagem.js';

/** Contrato mínimo de evento de domínio (mesma forma dos demais contextos — A03 §3). */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}

/**
 * Comando publicado por `SolicitarTriagemUseCase` (API) → consumido pelo worker `TriarEditalUseCase`
 * (A03 §§1,3; A17 §8). Payload enxuto; a triagem é assíncrona (custo/latência). `tenantId` sempre
 * presente, mesmo no MVP single-tenant (A01 §6).
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
