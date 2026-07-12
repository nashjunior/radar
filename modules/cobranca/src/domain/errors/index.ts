import { DomainError, type TenantId } from '@radar/kernel';

/** Fail-closed de auditoria (AB13/P-61, docs/05 §4) — reexportado do kernel, mesmo padrão de @radar/matching. */
export { AuditoriaIndisponivelError } from '@radar/kernel';

/**
 * `usoReservado` excederia (ou já excede) a cota do plano vigente — invariante da
 * Assinatura (docs/12 ERD; P-107 (3)). A reserva de fato é um UPDATE atômico na
 * borda; este erro cobre a reconstrução/validação do agregado em memória.
 */
export class CotaExcedidaError extends DomainError {
  readonly code = 'COTA_EXCEDIDA' as const;
  constructor(
    readonly tenantId: TenantId,
    readonly usoReservado: number,
    readonly cota: number,
    /** Hint de UI para o 402 (RAD-246) — true quando o plano vigente não é o topo do MVP. */
    readonly upgradeDisponivel: boolean = false,
  ) {
    super(`cota excedida para tenant '${tenantId}': usoReservado (${usoReservado}) > cota (${cota})`);
  }
}

/** Operação exige assinatura ativa (ou em trial) e o estado atual não permite. */
export class AssinaturaInativaError extends DomainError {
  readonly code = 'ASSINATURA_INATIVA' as const;
  constructor(tenantId: TenantId, estado: string) {
    super(`assinatura do tenant '${tenantId}' não permite esta operação no estado '${estado}'`);
  }
}

/** Nenhuma Assinatura encontrada para o tenant informado. */
export class AssinaturaNaoEncontradaError extends DomainError {
  readonly code = 'ASSINATURA_NAO_ENCONTRADA' as const;
  constructor(tenantId: TenantId) {
    super(`assinatura não encontrada para tenant '${tenantId}'`);
  }
}

/**
 * Falha de transporte no ACL do gateway de pagamento (RAD-249) — rede indisponível,
 * timeout ou resposta 5xx/4xx do provedor (Asaas por padrão, P-107 (a)). O tipo/erro
 * cru do SDK/HTTP do provedor NUNCA cruza para `application`/`domain` — só este.
 */
export class PagamentoGatewayIndisponivelError extends DomainError {
  readonly code = 'PAGAMENTO_GATEWAY_INDISPONIVEL' as const;
  constructor(provedor: string, motivo?: string) {
    super(`gateway de pagamento '${provedor}' indisponível${motivo ? `: ${motivo}` : ''}`);
  }
}

/** `planoCodigo` do checkout (POST /api/checkout/iniciar, RAD-264) não corresponde a nenhum plano comercial vigente. */
export class PlanoComercialNaoEncontradoError extends DomainError {
  readonly code = 'PLANO_COMERCIAL_NAO_ENCONTRADO' as const;
  constructor(codigo: string) {
    super(`plano comercial não encontrado: '${codigo}'`);
  }
}
