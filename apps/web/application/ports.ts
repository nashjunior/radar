import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { TriagemViewModel } from '@/domain/triagem-view-model';
import type { EditalDetalhe } from '@/domain/edital-detalhe';
import type { AlertaCardItem } from '@/domain/alerta-card';
import type { SessaoUsuario } from '@/domain/sessao';
import type { AssinaturaViewModel } from '@/domain/assinatura';

// ---------------------------------------------------------------------------
// Sessão (P-52 · RAD-213 — GET /api/me)
// ---------------------------------------------------------------------------

/**
 * Port de sessão — GET /api/me.
 * Implementado por SessaoHttpGateway (prod) ou SessaoStubGateway (dev/test).
 */
export interface SessaoGateway {
  obter(signal: AbortSignal): Promise<SessaoUsuario>;
}

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
  regiaoUf?: string;
  /** Código da faixa de valor da tabela de referência (Lei 14.133/2021). */
  faixaValorCodigo?: string;
  palavrasChave?: string[];
}

export interface CriterioResposta {
  id: string;
  regiaoUf: string | null;
  faixaValorMin: number | null;
  faixaValorMax: number | null;
  palavrasChave: string[];
  ativo: boolean;
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

// ---------------------------------------------------------------------------
// Notificação (US-10 · SalvarPreferencias — PUT /api/notificacao/preferencias)
// Não existe GET de preferências — página abre nos defaults, não finge ler do servidor.
// Refs: apps/api/src/routes/notificacao.ts:44, docs/14 §4, P-88 (WhatsApp fora do MVP).
// ---------------------------------------------------------------------------

export type FrequenciaNotificacao = 'IMEDIATA' | 'DIARIA' | 'SEMANAL';
export type CanalNotificacao = 'EMAIL' | 'IN_APP';

export interface SalvarPreferenciasInput {
  canais: CanalNotificacao[];
  frequencia: FrequenciaNotificacao;
}

export interface PreferenciasNotificacaoDTO {
  canais: string[];
  frequencia: string;
}

export interface NotificacaoGateway {
  salvarPreferencias(input: SalvarPreferenciasInput, signal: AbortSignal): Promise<PreferenciasNotificacaoDTO>;
}

// ---------------------------------------------------------------------------
// Organização (RAD-286 — POST /api/organizacoes · onboarding pós-login sem tenant)
// ---------------------------------------------------------------------------

/** Resposta de POST /api/organizacoes. */
export interface OrganizacaoDTO {
  tenantId: string;
  cnpj: string;
  razaoSocial: string;
  papel: string;
}

/**
 * Port de organização — POST /api/organizacoes.
 * Cria o tenant a partir do CNPJ+razão social do usuário autenticado sem organização.
 * Erros mapeados: CNPJ_INVALIDO, ORGANIZACAO_JA_EXISTE (ver application/errors.ts).
 * Implementado por OrganizacaoHttpGateway (prod) ou OrganizacaoStubGateway (dev/test).
 */
export interface OrganizacaoGateway {
  provisionar(
    input: { cnpj: string; razaoSocial: string },
    signal: AbortSignal,
  ): Promise<OrganizacaoDTO>;
}

// ---------------------------------------------------------------------------
// Assinatura (P-107 · RAD-264 — GET /api/me/assinatura, POST /api/checkout/iniciar)
// ---------------------------------------------------------------------------

/**
 * Port de assinatura — lê o estado do plano/cota e inicia o checkout hospedado.
 * POST /api/checkout/iniciar requer { planoCodigo } e retorna { urlCheckout } — o front
 * redireciona e nada mais. Contrato ratificado em RAD-264 (divergia do rascunho de RAD-251).
 * Implementado por AssinaturaHttpGateway (prod) ou AssinaturaStubGateway (dev/test).
 */
export interface AssinaturaGateway {
  obter(signal: AbortSignal): Promise<AssinaturaViewModel>;
  iniciarCheckout(input: { planoCodigo: string }, signal: AbortSignal): Promise<{ urlCheckout: string }>;
}
