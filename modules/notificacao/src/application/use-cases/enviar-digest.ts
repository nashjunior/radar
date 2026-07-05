import type { TenantId } from '@radar/kernel';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import { Notificacao, NotificacaoId, UsuarioId } from '../../domain/entities/notificacao.js';
import { Canal } from '../../domain/value-objects/canal.js';
import type { DigestDTO } from '../dtos.js';
import { NotificacaoEnviada } from '../events.js';
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
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    private readonly notificacoes: NotificacaoRepository,
    private readonly notifier: Notifier,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
  ) {}

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

    let notificacao = Notificacao.criar({
      id: NotificacaoId(this.ids.gerar()),
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      alertaId: alertaAncora.id,
      canal,
    });

    try {
      await this.notifier.enviar({
        canal,
        destinatario: input.emailDestinatario,
        assunto: `${selecionados.length} novo(s) alerta(s) — Radar de Licitações`,
        corpo: montarCorpoDigest(selecionados, pendentes.length),
        signal,
      });
      notificacao = notificacao.marcarEnviada();
    } catch {
      notificacao = notificacao.marcarFalhou();
      throw new CanalIndisponivelError(canal.tipo);
    } finally {
      await this.notificacoes.salvar(notificacao, signal);
    }

    await this.eventos.publicar(
      new NotificacaoEnviada({
        notificacaoId: notificacao.id,
        tenantId: notificacao.tenantId,
        usuarioId: notificacao.usuarioId,
        alertaId: notificacao.alertaId,
        canal: notificacao.canal.tipo,
      }),
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
