import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemViewModel } from '@/domain/triagem-view-model';
import type { EditalDetalhe } from '@/domain/edital-detalhe';
import type { AlertaCardItem } from '@/domain/alerta-card';

/**
 * Port de saída: repositório de triagens (implementado pela infra/).
 * A UI NUNCA chama a infra diretamente — só via use cases (A12 §2).
 */
export interface TriagemGateway {
  buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null>;
  /** US-07 pull trigger: solicita análise por IA. Retorna 'processando'; idempotente. */
  solicitar(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<{ editalId: EditalId; estado: 'processando' }>;
  /** RAD-81 UTI1: usuário aceita a análise. */
  aceitar(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId }, signal: AbortSignal): Promise<void>;
  /** RAD-81 UTI1: usuário contesta a análise. motivo é opcional (minimização P-03). */
  contestar(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId; motivo?: string }, signal: AbortSignal): Promise<void>;
  /** RAD-81 UTI2: usuário registra decisão go/no-go. */
  registrarDecisao(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId; go: boolean }, signal: AbortSignal): Promise<void>;
}

/**
 * Port de autenticação — implementado por CognitoOidcGateway (prod) ou DevAuthGateway (dev).
 * A UI interage via AuthProvider/useAuth; nunca acessa o gateway diretamente.
 * Refs: docs/98 P-08, P-91, arquitetura/08 §3.
 */
export interface AuthPort {
  /** Retorna o ID token JWT atual, ou null se não autenticado/expirado. */
  obterToken(): Promise<string | null>;
  /** Inicia o fluxo de login (redireciona para o Cognito Hosted UI). */
  iniciarLogin(): Promise<void>;
  /** Encerra a sessão. */
  encerrarSessao(): Promise<void>;
  /**
   * Troca o authorization code por tokens (callback do IdP).
   * Deve ser invocado quando a URL contém code= e state=.
   */
  processarCallback(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Matching (US-04 · DefinirCritério, US-06 · RegistrarFeedback)
// Refs: apps/api/src/routes/matching.ts, arquitetura/15 §5.
// ---------------------------------------------------------------------------

export interface DefinirCriterioInput {
  ramoCnae?: string;
  regiaoUf?: string;
  /** Código da faixa de valor da tabela de referência (Lei 14.133/2021). */
  faixaValorCodigo?: string;
  palavrasChave?: string[];
}

export interface CriterioResposta {
  id: string;
  ramoCnae: string | null;
  regiaoUf: string | null;
  faixaValorMin: number | null;
  faixaValorMax: number | null;
  palavrasChave: string[];
  ativo: boolean;
  /** Presente na demo após rematch do lote PNCP. */
  alertasGerados?: number;
}

/**
 * Port de matching — POST /api/matching/criterios e PATCH /api/matching/alertas/:id/feedback.
 * Implementado por MatchingHttpGateway (prod) ou MatchingStubGateway (dev/test).
 */
export interface MatchingApiGateway {
  definirCriterio(input: DefinirCriterioInput, signal: AbortSignal): Promise<CriterioResposta>;
  registrarFeedback(input: { alertaId: string; relevante: boolean }, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// Edital (US-03 · DetalheDoEdital — RAD-111)
// Aguardando endpoint GET /api/editais/:id no BFF (A VALIDAR).
// ---------------------------------------------------------------------------

/**
 * Port de edital — GET /api/editais/:id (futuro).
 * Implementado por EditalStubGateway até o endpoint existir no BFF.
 */
export interface EditalGateway {
  buscarDetalhes(editalId: EditalId, signal: AbortSignal): Promise<EditalDetalhe | null>;
}

// ---------------------------------------------------------------------------
// Perfil de Habilitação (US-15 · RAD-110)
// Contrato definitivo publicado em RAD-109. Enquanto pendente, stub é usado.
// ---------------------------------------------------------------------------

/** Quatro campos texto-livre do MVP — sem upload, sem ObjectStorage (P-99 resolvido). */
export interface PerfilHabilitacaoDTO {
  habJuridica: string;
  habFiscal: string;
  habTecnica: string;
  habEconomica: string;
}

/**
 * Port de perfil de habilitação — GET/PUT /api/perfil-habilitacao (futuro).
 * Implementado por PerfilHabilitacaoStubGateway até RAD-109 publicar o endpoint.
 */
export interface PerfilHabilitacaoGateway {
  consultar(signal: AbortSignal): Promise<PerfilHabilitacaoDTO | null>;
  salvar(input: PerfilHabilitacaoDTO, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// Alertas (US-01 · ListarAlertas — RAD-147)
// Aguardando endpoint GET /api/alertas no BFF.
// AlertaDTO.proveniencia agora disponível no backend (RAD-115).
// ---------------------------------------------------------------------------

/**
 * Port de alertas — GET /api/alertas (futuro).
 * Implementado por AlertasStubGateway até o endpoint existir no BFF.
 */
export interface AlertasApiGateway {
  listar(signal: AbortSignal): Promise<AlertaCardItem[]>;
}
