import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { AuditoriaBaseLegalInvalidaError } from '../errors/index.js';

declare const __brand: unique symbol;

/** Identificador opaco de um registro de auditoria. */
export type AuditLogId = string & { readonly [__brand]: 'AuditLogId' };
export const AuditLogId = (raw: string): AuditLogId => raw as AuditLogId;

/**
 * Escopo de isolamento do evento auditado — quem é o dono dos dados (P-51/P-62).
 * clienteFinalId é opcional: operações de nível de tenant não têm clienteFinal.
 */
export interface EscopoAuditoria {
  readonly tenantId: TenantId;
  readonly clienteFinalId?: ClienteFinalId;
}

export interface CriarRegistroProps {
  readonly id: AuditLogId;
  readonly usuarioId: string;
  readonly recurso: string;
  readonly acao: string;
  readonly baseLegal: string;
  readonly escopo: EscopoAuditoria;
  readonly ocorridoEm: Date;
}

/**
 * Registro imutável de auditoria (docs/14 §5, P-61, AB13).
 * Sem mutações: append-only. Não carrega PII nem segredos no payload.
 * Campos: quem (usuarioId), quando (ocorridoEm), o quê (recurso+acao),
 *          base legal (baseLegal), escopo (tenantId/clienteFinalId).
 */
export class RegistroAuditoria {
  private constructor(
    readonly id: AuditLogId,
    readonly usuarioId: string,
    readonly recurso: string,
    readonly acao: string,
    readonly baseLegal: string,
    readonly escopo: EscopoAuditoria,
    readonly ocorridoEm: Date,
  ) {}

  static criar(props: CriarRegistroProps): RegistroAuditoria {
    // trim() não captura zero-width spaces (U+200B–U+200D) nem BOM (U+FEFF) — strip explícito.
    // eslint-disable-next-line no-control-regex
    if (!props.baseLegal.replace(/[\s\u200B-\u200D\uFEFF]/g, ''))
      throw new AuditoriaBaseLegalInvalidaError();
    return new RegistroAuditoria(
      props.id,
      props.usuarioId,
      props.recurso,
      props.acao,
      props.baseLegal,
      props.escopo,
      props.ocorridoEm,
    );
  }
}
