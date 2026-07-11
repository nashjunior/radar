import type { TenantId } from '@radar/kernel';
import { UsuarioId } from '../../domain/entities/notificacao.js';
import { Canal } from '../../domain/value-objects/canal.js';
import { CAP_DIGEST } from '../../domain/value-objects/frequencia.js';
import type { AlertaResumoDTO, DigestDTO, ExcedenteAgrupadoDTO } from '../dtos.js';
import { EnvioNotificacaoService } from '../services/envio-notificacao-service.js';
import type {
  AlertaRepository,
  EventPublisher,
  IdProvider,
  NotificacaoRepository,
  Notifier,
  PreferenciaRepository,
} from '../ports.js';

export interface EnviarDigestInput {
  usuarioId: UsuarioId;
  tenantId: TenantId;
  emailDestinatario: string;
  janela: { inicio: Date };
}

/**
 * Agrupa alertas pendentes do período e envia um digest.
 * Trigger: scheduler (diário ou semanal).
 * Anti-fadiga (P-81, docs/11 §4): cap por frequência, ordenação prazo→aderência (feita
 * pelo repositório — contrato de `pendentesDigest`) e excedente agrupado por critério/órgão.
 * Usuários com frequência IMEDIATA recebem por alerta individual, não digest.
 * Alertas críticos não chegam aqui: já foram entregues por `NotificarAlertaUseCase` e
 * `pendentesDigest` só devolve o que ainda não foi notificado.
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
    private readonly caps: Record<'DIARIA' | 'SEMANAL', number> = CAP_DIGEST,
  ) {
    this.envio = new EnvioNotificacaoService(notificacoes, notifier, eventos, ids);
  }

  async executar(input: EnviarDigestInput, signal: AbortSignal): Promise<DigestDTO> {
    const preferencia = await this.preferencias.porUsuario(input.usuarioId, signal);

    if (!preferencia || preferencia.frequencia === 'IMEDIATA') {
      return { enviados: 0, agrupados: 0, total: 0 };
    }

    const limite = this.caps[preferencia.frequencia];

    const { selecionados, excedentes, totalPendentes } = await this.alertas.pendentesDigest(
      { usuarioId: input.usuarioId, aPartirDe: input.janela.inicio, limite },
      signal,
    );

    if (totalPendentes === 0) return { enviados: 0, agrupados: 0, total: 0 };

    const canal = Canal.criar(preferencia.canais[0] ?? 'EMAIL');
    const alertaAncora = selecionados[0];
    if (!alertaAncora) return { enviados: 0, agrupados: 0, total: 0 };

    await this.envio.enviarComRegistro(
      {
        tenantId: input.tenantId,
        usuarioId: input.usuarioId,
        alertaId: alertaAncora.id,
        canal,
        destinatario: input.emailDestinatario,
        assunto: `${selecionados.length} novo(s) alerta(s) — Radar de Licitações`,
        corpo: montarCorpoDigest(selecionados, excedentes),
      },
      signal,
    );

    return {
      enviados: selecionados.length,
      agrupados: excedentes.reduce((n, e) => n + e.quantidade, 0),
      total: totalPendentes,
    };
  }
}

function montarCorpoDigest(
  alertas: AlertaResumoDTO[],
  excedentes: ExcedenteAgrupadoDTO[],
): string {
  const linhas = alertas.map(
    a =>
      `• ${a.objeto} · ${a.orgao} · Prazo: ${a.prazoProposta ? a.prazoProposta.toLocaleDateString('pt-BR') : 'a definir'} · Aderência: ${(a.aderencia * 100).toFixed(0)}%`,
  );

  if (excedentes.length === 0) return linhas.join('\n');

  const total = excedentes.reduce((n, e) => n + e.quantidade, 0);
  const grupos = excedentes.map(e => `• ${e.quantidade} em "${e.criterioNome}" · ${e.orgao}`);

  return [
    ...linhas,
    `\n+ ${total} alerta(s) além do limite desta edição — agrupados abaixo, todos disponíveis no painel:`,
    ...grupos,
  ].join('\n');
}
