import type { ClienteFinalId, TenantId } from '@radar/kernel';
import type { AuditLogId, RegistroAuditoria } from '../domain/entities/registro-auditoria.js';
import type { SolicitacaoId, SolicitacaoTitular } from '../domain/entities/solicitacao-titular.js';

/** Persiste registros de auditoria. Implementação deve ser append-only (imutável). */
export interface AuditLogRepository {
  registrar(registro: RegistroAuditoria, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs para AuditLogId. A construção do branded type ocorre na infra. */
export interface AuditLogIdProvider {
  gerar(): AuditLogId;
}

/** Relógio da aplicação — injetável para testes determinísticos. */
export interface Clock {
  agora(): Date;
}

// ---------------------------------------------------------------------------
// Tipos de retenção (RAD-101 / P-05 / P-44 / docs/05 §5)
// ---------------------------------------------------------------------------

/**
 * Classes de dados cobertas pela política de retenção.
 * Mapeiam 1:1 com as linhas da tabela de retenção aprovada em RAD-100.
 */
export type ConjuntoDados =
  | 'CATALOGO_PUBLICO'
  | 'ANEXO_PDF'
  | 'DADO_PESSOAL_TERCEIRO'
  | 'CONTA_USUARIO'
  | 'ESTRATEGIA_COMERCIAL'
  | 'NOTIFICACAO_LOG'
  | 'PROVENIENCIA'
  | 'AUDIT_LOG'
  | 'SOLICITACAO_TITULAR';

/** Ação a aplicar quando o prazo de um item vencer. */
export type AcaoRetencao = 'ELIMINAR' | 'ANONIMIZAR' | 'PRESERVAR';

/** Razão pela qual um item não pode ser expurgado apesar da política pedir. */
export type ExcecaoRetencao =
  | 'LEGAL_HOLD'
  | 'AUDITORIA'
  | 'DEFESA_DIREITOS'
  | 'OBRIGACAO_LEGAL';

/** Configuração de um conjunto de dados dentro da política versionada. */
export interface ConfiguracaoConjunto {
  readonly conjunto: ConjuntoDados;
  readonly acao: AcaoRetencao;
}

/**
 * Política de retenção versionada — nunca contém prazos hard-coded;
 * prazos são decididos externamente e materializam os candidatos via ExpurgoCandidatoRepository.
 */
export interface PoliticaRetencao {
  readonly versao: string;
  readonly conjuntos: ReadonlyArray<ConfiguracaoConjunto>;
}

/** Item elegível para expurgo já calculado pela infra (prazo vencido). */
export interface CandidatoExpurgo {
  /** Identificador opaco do item — sem PII diretamente exposta. */
  readonly itemId: string;
  readonly conjunto: ConjuntoDados;
  /** Presente quando o item está sob exceção e NÃO deve ser expurgado. */
  readonly excecao?: ExcecaoRetencao;
}

/** Resultado do processamento de um candidato individual. */
export interface ResultadoExpurgo {
  readonly itemId: string;
  readonly conjunto: ConjuntoDados;
  readonly acao: AcaoRetencao | 'RETIDO_POR_EXCECAO';
  readonly excecao?: ExcecaoRetencao;
}

/** DTO de saída do AplicarRetencaoUseCase — relatório de execução. */
export interface RetencaoDTO {
  readonly politicaVersao: string;
  readonly elegiveis: number;
  readonly aplicados: number;
  readonly retidosPorExcecao: number;
  readonly resultados: readonly ResultadoExpurgo[];
}

/**
 * Lista itens elegíveis para expurgo (prazo vencido segundo a política)
 * por conjunto de dados. Não vaza PII nos identificadores retornados.
 */
export interface ExpurgoCandidatoRepository {
  listarElegiveis(
    conjunto: ConjuntoDados,
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<readonly CandidatoExpurgo[]>;
}

/**
 * Aplica a ação de expurgo a um item específico.
 * Implementações cobrem banco de dados e object storage conforme o conjunto.
 */
export interface ExpurgoPort {
  eliminar(conjunto: ConjuntoDados, itemId: string, signal: AbortSignal): Promise<void>;
  anonimizar(conjunto: ConjuntoDados, itemId: string, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// Portas para direitos do titular (RAD-98 / US-12 / P-57 / AB10)
// ---------------------------------------------------------------------------

/** Persiste e recupera solicitações LGPD de titulares. */
export interface SolicitacaoTitularRepository {
  salvar(solicitacao: SolicitacaoTitular, signal: AbortSignal): Promise<void>;
  porId(id: SolicitacaoId, signal: AbortSignal): Promise<SolicitacaoTitular | null>;
}

/** Gerador de IDs opacos para SolicitacaoTitular. */
export interface SolicitacaoIdProvider {
  gerar(): SolicitacaoId;
}

/** Resultado da verificação de identidade do titular pelo gateway de identidade/DPO. */
export interface ResultadoVerificacaoIdentidade {
  readonly verificada: boolean;
  /** `false` quando o titular foi identificado, mas não pertence ao escopo solicitado (AB10/IDOR). */
  readonly vinculadoAoEscopo?: boolean;
  /** Referência opaca à evidência de verificação — sem PII no domínio. */
  readonly evidenciaRef?: string;
}

/**
 * Gateway de verificação de identidade do titular (AB10/P-57).
 * A implementação pode chamar o IdP, o processo DPO ou verificação manual.
 * NUNCA retorna dados do titular — apenas o resultado da verificação.
 */
export interface IdentidadeGateway {
  verificarTitular(
    titularRef: string,
    tenantId: TenantId,
    clienteFinalId: ClienteFinalId | undefined,
    signal: AbortSignal,
  ): Promise<ResultadoVerificacaoIdentidade>;
}

/** Itens de dados pessoais do titular encontrados no sistema (para tipo=acesso). */
export interface ItemDadoTitular {
  /** Categoria do dado (NUNCA o valor — apenas referência/tipo para auditoria). */
  readonly categoria: string;
  /** Fonte/origem do dado (ex: 'pncp', 'usuario-cadastro'). */
  readonly fonte: string;
  /** Base legal do tratamento. */
  readonly baseLegal: string;
}

/** DTO de saída de AtenderSolicitacaoTitularUseCase (US-12). */
export interface SolicitacaoDTO {
  readonly solicitacaoId: SolicitacaoId;
  readonly tipo: 'acesso' | 'correcao' | 'eliminacao';
  readonly estado: string;
  readonly motivoRecusa?: string;
  /**
   * Para tipo=acesso: sumário de categorias de dados retidas (SEM valores pessoais).
   * Para correção/eliminação: undefined — resultado operacional.
   */
  readonly dadosTitular?: readonly ItemDadoTitular[];
  readonly observacao?: string;
}
