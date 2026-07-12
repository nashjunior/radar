import type { AlertaId, TenantId } from '@radar/kernel';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import { Notificacao, NotificacaoId, type UsuarioId } from '../../domain/entities/notificacao.js';
import type { Canal } from '../../domain/value-objects/canal.js';
import { NotificacaoEnviada } from '../events.js';
import type { EventPublisher, IdProvider, NotificacaoRepository, Notifier } from '../ports.js';

export interface EnviarComRegistroInput {
  tenantId: TenantId;
  usuarioId: UsuarioId;
  alertaId: AlertaId;
  canal: Canal;
  destinatario: string;
  assunto: string;
  corpo: string;
  /** `occurredAt` do `alerta.gerado` de origem — ausente no digest (A18 §5). */
  alertaGeradoEm?: Date;
}

/**
 * Envia uma notificação e registra o resultado — usado por `NotificarAlertaUseCase`
 * (imediato) e `EnviarDigestUseCase` (agrupado). A decisão de SE/QUANDO enviar
 * (elegibilidade, agrupamento, cap) continua em cada use case; este serviço só
 * encapsula o "enviar + marcar + persistir + publicar" que era idêntico nos dois.
 *
 * Falha do notifier: `Notificacao` é salva com status FALHOU mesmo assim (rastreabilidade
 * de entrega) antes de relançar `CanalIndisponivelError` — por isso o `finally`.
 */
export class EnvioNotificacaoService {
  constructor(
    private readonly notificacoes: NotificacaoRepository,
    private readonly notifier: Notifier,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
  ) {}

  async enviarComRegistro(
    input: EnviarComRegistroInput,
    signal: AbortSignal,
  ): Promise<Notificacao> {
    let notificacao = Notificacao.criar({
      id: NotificacaoId(this.ids.gerar()),
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      alertaId: input.alertaId,
      canal: input.canal,
    });

    try {
      await this.notifier.enviar({
        canal: input.canal,
        destinatario: input.destinatario,
        assunto: input.assunto,
        corpo: input.corpo,
        signal,
      });
      notificacao = notificacao.marcarEnviada();
    } catch {
      notificacao = notificacao.marcarFalhou();
      throw new CanalIndisponivelError(input.canal.tipo);
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
        ...(input.alertaGeradoEm ? { alertaGeradoEm: input.alertaGeradoEm } : {}),
      }),
      signal,
    );

    return notificacao;
  }
}
