import type { TenantId } from '@radar/kernel';
import { UsuarioId } from '../../domain/entities/notificacao.js';
import { Canal } from '../../domain/value-objects/canal.js';
import type { DigestDTO } from '../dtos.js';
import { EnvioNotificacaoService } from '../services/envio-notificacao-service.js';
import type {
  AlertaRepository,
  EventPublisher,
  IdProvider,
  NotificacaoRepository,
  Notifier,
  PreferenciaRepository,
} from '../ports.js';

/** Cap de alertas por digest — [A VALIDAR] → P-81. */
const CAP_ALERTAS_DIGEST = 20;

export interface EnviarDigestInput {
  usuarioId: UsuarioId;
  tenantId: TenantId;
  emailDestinatario: string;
  janela: { inicio: Date };
}

/**
 * Agrupa alertas pendentes do período e envia um digest.
 * Trigger: scheduler (diário ou semanal).
 * Anti-fadiga: cap + ordenação por aderência decrescente (docs/11 §4).
 * Usuários com frequência IMEDIATA recebem por alerta individual, não digest.
 */
export class EnviarDigestUseCase {
  private readonly envio: EnvioNotificacaoService;

  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    notificacoes: NotificacaoRepository,
    notifier: Notifier,
    eventos: EventPublisher,
    ids: IdProvider,
  ) {
    this.envio = new EnvioNotificacaoService(notificacoes, notifier, eventos, ids);
  }

  async executar(input: EnviarDigestInput, signal: AbortSignal): Promise<DigestDTO> {
    const preferencia = await this.preferencias.porUsuario(input.usuarioId, signal);

    if (!preferencia || preferencia.frequencia === 'IMEDIATA') {
      return { enviados: 0, agrupados: 0 };
    }

    const pendentes = await this.alertas.pendentesDigest(
      { usuarioId: input.usuarioId, aPartirDe: input.janela.inicio },
      signal,
    );

    if (pendentes.length === 0) return { enviados: 0, agrupados: 0 };

    const selecionados = pendentes
      .sort((a, b) => b.aderencia - a.aderencia)
      .slice(0, CAP_ALERTAS_DIGEST);

    const canal = Canal.criar(preferencia.canais[0] ?? 'EMAIL');
    const alertaAncora = selecionados[0];
    if (!alertaAncora) return { enviados: 0, agrupados: 0 };

    await this.envio.enviarComRegistro(
      {
        tenantId: input.tenantId,
        usuarioId: input.usuarioId,
        alertaId: alertaAncora.id,
        canal,
        destinatario: input.emailDestinatario,
        assunto: `${selecionados.length} novo(s) alerta(s) — Radar de Licitações`,
        corpo: montarCorpoDigest(selecionados, pendentes.length),
      },
      signal,
    );

    return { enviados: selecionados.length, agrupados: pendentes.length };
  }
}

function montarCorpoDigest(
  alertas: Array<{ objeto: string; orgao: string; prazoProposta: Date | null; aderencia: number }>,
  total: number,
): string {
  const linhas = alertas.map(
    a =>
      `• ${a.objeto} · ${a.orgao} · Prazo: ${a.prazoProposta ? a.prazoProposta.toLocaleDateString('pt-BR') : 'a definir'} · Aderência: ${(a.aderencia * 100).toFixed(0)}%`,
  );
  const rodape =
    total > alertas.length
      ? `\n(+ ${total - alertas.length} alerta(s) não exibido(s) — acesse o painel para ver todos)`
      : '';
  return linhas.join('\n') + rodape;
}
