declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

/** Identificador opaco do tenant (empresa no sistema). Presente em TODA entidade. */
export type TenantId = Brand<string, 'TenantId'>;

/** Identificador do cliente final (empresa participante da licitação). */
export type ClienteFinalId = Brand<string, 'ClienteFinalId'>;

/** Identificador opaco de um edital no Radar (interno, não o numeroControlePNCP). */
export type EditalId = Brand<string, 'EditalId'>;

/** Identificador opaco do perfil de habilitação de um cliente. */
export type PerfilId = Brand<string, 'PerfilId'>;

/** Identificador opaco de um critério de monitoramento (Matching & Alerta). */
export type CriterioId = Brand<string, 'CriterioId'>;

/** Identificador opaco de um alerta gerado pelo matching. */
export type AlertaId = Brand<string, 'AlertaId'>;

/** Construtores de IDs — usados apenas na infra (entrada de dados externos). */
export const TenantId = (raw: string): TenantId => raw as TenantId;
export const ClienteFinalId = (raw: string): ClienteFinalId => raw as ClienteFinalId;
export const EditalId = (raw: string): EditalId => raw as EditalId;
export const PerfilId = (raw: string): PerfilId => raw as PerfilId;
export const CriterioId = (raw: string): CriterioId => raw as CriterioId;
export const AlertaId = (raw: string): AlertaId => raw as AlertaId;
