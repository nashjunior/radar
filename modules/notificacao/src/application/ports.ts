import type { AlertaId, ClienteFinalId } from '@radar/kernel';
import type { Canal } from '../domain/value-objects/canal.js';
import type { Notificacao } from '../domain/entities/notificacao.js';
import type { UsuarioId } from '../domain/entities/notificacao.js';
import type { AlertaResumoDTO, ClienteFinalDTO, PreferenciaDTO } from './dtos.js';
import type { DomainEvent } from './events.js';

// ---------------------------------------------------------------------------
// Ports de saída — nomenclatura por papel, adapter por tecnologia (A10 §8)
// ---------------------------------------------------------------------------

/** Visão somente-leitura dos alertas para Notificação. */
export interface AlertaRepository {
  porId(id: AlertaId, signal: AbortSignal): Promise<AlertaResumoDTO | null>;
  pendentesDigest(
    params: { usuarioId: UsuarioId; aPartirDe: Date },
    signal: AbortSignal,
  ): Promise<AlertaResumoDTO[]>;
}

/** Lê e persiste preferências de notificação do usuário. */
export interface PreferenciaRepository {
  porUsuario(id: UsuarioId, signal: AbortSignal): Promise<PreferenciaDTO | null>;
  salvar(preferencia: PreferenciaDTO, signal: AbortSignal): Promise<void>;
}

/** Persiste o registro de Notificacao para auditoria e idempotência. */
export interface NotificacaoRepository {
  salvar(notificacao: Notificacao, signal: AbortSignal): Promise<void>;
  /** Checa idempotência: retorna true se o alerta já foi entregue ao usuário. */
  jaNotificado(alertaId: AlertaId, usuarioId: UsuarioId, signal: AbortSignal): Promise<boolean>;
}

/** Entrega a mensagem pelo canal — tech-agnóstico (SES, webhook, in-app). */
export interface Notifier {
  enviar(params: {
    canal: Canal;
    destinatario: string;
    assunto: string;
    corpo: string;
    signal: AbortSignal;
  }): Promise<void>;
}

/** Publicação de eventos de domínio na fila (Published Language — A03 §3). */
export interface EventPublisher {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/** Gerador de IDs únicos. Injetado na infra. */
export interface IdProvider {
  gerar(): string;
}

/**
 * Gateway cross-contexto para Identidade/preferência (docs/13 §5 — Cliente-Fornecedor).
 * MVP: 1 usuário por clienteFinal (P-25); retorna null se o cliente não existir.
 * Mesmo padrão do PerfilGateway da Triagem (decisão P-83).
 */
export interface ClienteFinalGateway {
  porId(id: ClienteFinalId, signal: AbortSignal): Promise<ClienteFinalDTO | null>;
}
