import type { RegistroDeUsoId, TenantId } from '@radar/kernel';
import type { Assinatura } from '../domain/entities/assinatura.js';
import type { RegistroDeUso } from '../domain/entities/registro-de-uso.js';
import type { PlanoComercial } from '../domain/value-objects/plano-comercial.js';
import type { ComandoPagamento } from './dtos.js';
import type { DomainEvent } from './events.js';

/**
 * Repositório do agregado Assinatura (docs/13 §3). `reservarCota` é o UPDATE
 * atômico do gate de entitlement (P-107 (3)) — decide sob concorrência sem
 * carregar o agregado em memória; consumidores fora deste módulo (middleware de
 * gate/402) chegam nele só por aqui, nunca com SQL cru.
 */
export interface AssinaturaRepository {
  porTenantId(tenantId: TenantId, signal: AbortSignal): Promise<Assinatura | null>;

  /**
   * Mapeamento `assinaturaExternaId -> Assinatura` (P-107 (5), RAD-250) — a ÚNICA
   * fonte confiável de `tenantId` no caminho do webhook do gateway. O payload do
   * provedor NUNCA é usado para derivar tenant (anti-IDOR); `null` quando nenhuma
   * Assinatura mapeia o ID externo — o webhook descarta e loga, nunca cria.
   */
  porAssinaturaExternaId(assinaturaExternaId: string, signal: AbortSignal): Promise<Assinatura | null>;

  /** Persiste transições de ciclo de vida (`ativar`, `suspender`, `renovarCiclo` etc.). */
  salvar(assinatura: Assinatura, signal: AbortSignal): Promise<void>;

  /**
   * `UPDATE assinatura SET uso_reservado = uso_reservado + 1 WHERE tenant_id = $1
   * AND status IN ('ativa','trial') AND uso_reservado < cota_triagens_mes`
   * (P-107 (3)) — sem read-modify-write, decide sob concorrência no próprio banco.
   * Retorna `false` quando 0 linhas afetadas (cota esgotada OU assinatura fora de
   * {ativa,trial}) — o chamador (RAD-246) qualifica o motivo com uma leitura de
   * apoio só para compor o corpo do erro; a decisão do gate já foi tomada aqui.
   */
  reservarCota(tenantId: TenantId, signal: AbortSignal): Promise<boolean>;

  /**
   * Compensação da reserva no caminho de falha (P-107 (c), RAD-246) — decrementa
   * `uso_reservado` sem nunca deixá-lo negativo (`GREATEST(uso_reservado - 1, 0)`).
   * Usada quando o publish de `triagem.solicitada` falha depois da reserva
   * concedida, ou quando a rota rejeita a requisição por outro motivo síncrono
   * (editalId inválido, perfil não encontrado) — a reserva nunca deve sobreviver a
   * uma triagem que não foi de fato enfileirada, senão a cota vaza.
   */
  liberarReserva(tenantId: TenantId, signal: AbortSignal): Promise<void>;

  /**
   * `UPDATE assinatura SET uso_confirmado = uso_confirmado + 1 WHERE tenant_id =
   * $1` (RAD-247) — marca 1 unidade de reserva como faturável. NÃO decrementa
   * `uso_reservado` (RAD-275): a reserva só volta ao pool na falha
   * (`liberarReserva`), nunca na confirmação — senão a cota mensal deixa de
   * existir na prática. Chamada só depois de `RegistroDeUsoRepository.registrar`
   * retornar `true` (nunca no duplo-clique/replay do consumidor de
   * `triagem.concluida`).
   */
  confirmarUso(tenantId: TenantId, signal: AbortSignal): Promise<void>;
}

/**
 * Repositório de RegistroDeUso — idempotência da fatura pela chave natural
 * `(tenantId, clienteFinalId, editalId, perfilId, periodo)` (P-107 (4)).
 */
export interface RegistroDeUsoRepository {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING` pela chave natural + período. Retorna
   * `true` quando a linha foi de fato inserida (primeira entrega) e `false` no
   * duplo-clique/replay do SQS — o chamador não deve mexer no agregado nesse caso.
   */
  registrar(registro: RegistroDeUso, signal: AbortSignal): Promise<boolean>;
}

/** Gerador de IDs únicos para `RegistroDeUso`. Injetado na infra para isolabilidade. */
export interface IdProvider {
  gerar(): RegistroDeUsoId;
}

/**
 * Publicação de eventos de domínio na fila (Published Language — arquitetura/03
 * §3). Hoje só `CotaAlertaAtingida` (RAD-247) — Cobrança continua majoritariamente
 * downstream (consumidora de `triagem.concluida`/`triagem.falhou`), mas passa a
 * produtora deste único evento interno de notificação.
 */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/**
 * Dados do PRÓPRIO tenant necessários para KYC/fatura no gateway (RAD-249) — nunca
 * dado de cliente-final. Distinto da classe crítica de docs/05 §9 (estratégia
 * comercial do cliente): razão social/CNPJ/e-mail do Tenant são a entidade
 * faturada, não `editalId`/`perfilId`/nome de cliente-final/aderência/decisão.
 */
export interface DadosClienteCobranca {
  readonly tenantId: TenantId;
  readonly razaoSocial: string;
  readonly cpfCnpj: string;
  readonly email: string;
}

/**
 * Status mínimo de reconciliação/suporte (RAD-249) — NUNCA aciona mudança de
 * estado da `Assinatura`: ativação/dunning só pelo webhook `invoice.paid`/
 * `payment_failed` (RAD-250), nunca por uma consulta síncrona ao gateway.
 */
export interface StatusAssinaturaExterna {
  readonly statusExterno: string;
  readonly proximoVencimento: Date | null;
}

/**
 * ACL do gateway de pagamento (P-107 (5)/(7)/(a); padrão do `LlmGateway`, A10 §4.6)
 * — verbos do NOSSO domínio, nunca do provedor; comprado e trocável (swap-safe,
 * P-66). Nenhum tipo do provedor cruza para `domain`/`application`. Minimização
 * (docs/05 §9): só plano, `tenantId`/IDs opacos e os dados de KYC do próprio
 * tenant cruzam esta fronteira — NUNCA `editalId`/`perfilId`/nome de
 * cliente-final/aderência/decisão/preço pretendido. Erros do provedor viram
 * `DomainError` no adapter (nunca o tipo cru do SDK/HTTP). Vendor default de GTM:
 * Asaas (P-107 (a), `[A VALIDAR]` fees/DPA/residência).
 */
export interface PagamentoGateway {
  /** KYC do tenant no gateway — chamado uma vez, tipicamente no início do trial. */
  criarClienteDeCobranca(dados: DadosClienteCobranca, signal: AbortSignal): Promise<string>;

  /**
   * Retorna só a URL do checkout hospedado (cartão/PIX/boleto, tokenizado — PAN
   * nunca toca o Radar, SAQ-A). O RETORNO do checkout NÃO ativa nada — ativação
   * só no webhook `invoice.paid` (RAD-250), pagamento é assíncrono.
   */
  abrirCheckoutHospedado(plano: PlanoComercial, tenantId: TenantId, signal: AbortSignal): Promise<string>;

  /** Consulta somente leitura — reconciliação/suporte, nunca gate de autorização. */
  consultarAssinatura(
    assinaturaExternaId: string,
    signal: AbortSignal,
  ): Promise<StatusAssinaturaExterna | null>;

  cancelarAssinatura(assinaturaExternaId: string, signal: AbortSignal): Promise<void>;
}

/**
 * Dedupe de entrega do webhook pelo `eventId` do PRÓPRIO provedor (P-107 (5),
 * RAD-250) — anti-replay e anti-reentrega. Nunca decide o comando (isso é do
 * `ProcessarEventoDePagamentoUseCase`); só registra que este evento já foi visto.
 */
export interface WebhookEventoRepository {
  /**
   * `INSERT ... ON CONFLICT (provedor, evento_externo_id) DO NOTHING`. Retorna
   * `true` na primeira entrega (o caller deve processar) e `false` no replay/
   * reentrega (o caller deve tratar como no-op, sem tocar no agregado).
   */
  registrarSePrimeiraVez(provedor: string, eventoExternoId: string, signal: AbortSignal): Promise<boolean>;

  /**
   * Compensação do dedupe (RAD-250) — desfaz a marca de `registrarSePrimeiraVez`
   * quando o processamento falha DEPOIS da reserva (auditoria indisponível, erro de
   * infra ao persistir a transição). Sem isso, uma falha transitória depois do claim
   * faria a reentrega do provedor (at-least-once) cair como replay para sempre —
   * "resistente a replay" viraria "perde o evento". Mesmo padrão de
   * `AssinaturaRepository.liberarReserva` (P-107 (c)).
   */
  desfazerRegistro(provedor: string, eventoExternoId: string, signal: AbortSignal): Promise<void>;
}

/**
 * Trilha auditável do webhook (evento recebido → decisão tomada, docs/05 §4) —
 * é dinheiro e acesso. `tenantId: null` cobre o caso anti-IDOR (assinaturaExterna
 * desconhecida): a decisão ainda é auditável mesmo sem tenant resolvido.
 */
export interface EventoPagamentoAuditoria {
  readonly eventoExternoId: string;
  readonly assinaturaExternaId: string;
  readonly tenantId: TenantId | null;
  readonly decisao: string;
}

/** Fail-closed (AB13/P-61): a implementação deve lançar (`AuditoriaIndisponivelError`) se não gravar. */
export interface AuditoriaWebhookPagamentoPort {
  registrar(entrada: EventoPagamentoAuditoria, signal: AbortSignal): Promise<void>;
}

/**
 * Catálogo de planos comerciais disponíveis para contratação (docs/09 §6.1 —
 * Starter/Pro/Consultoria, preços `[A VALIDAR]`, P-107 (a)/(b)). Resolve o
 * `planoCodigo` recebido em `POST /api/checkout/iniciar` (RAD-264) num
 * `PlanoComercial` completo (cota + preço) antes de abrir o checkout — o cliente
 * nunca envia cota/preço, só o código. `null` quando o código não corresponde a
 * nenhum plano vigente.
 */
export interface PlanoComercialCatalogo {
  porCodigo(codigo: string, signal: AbortSignal): Promise<PlanoComercial | null>;
}

/** Relógio injetável — testabilidade de `diasRestantes` (RAD-264) sem `Date` real no use case. */
export interface ClockProvider {
  agora(): Date;
}

/**
 * Fila de processamento assíncrono do webhook (P-107 (5), compensação OBRIGATÓRIA
 * do aceite de segurança RAD-253 por não haver HMAC no raw body do Asaas): a rota
 * HTTP só autentica + traduz + enfileira — nunca chama o gateway de confirmação
 * outbound nem muta o agregado dentro do ciclo de request/response do provedor.
 * `ProcessarEventoDePagamentoUseCase` roda de fato num worker (`WebhookPagamentoWorker`),
 * desacoplado do timing/timeout da entrega do webhook.
 */
export interface FilaDeProcessamentoDeWebhook {
  enfileirar(comando: ComandoPagamento, signal: AbortSignal): Promise<void>;
}
