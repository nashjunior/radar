import type { AlertaId, ClienteFinalId, TenantId } from '@radar/kernel';
import { CanalIndisponivelError } from '../../domain/errors/index.js';
import { Notificacao, NotificacaoId } from '../../domain/entities/notificacao.js';
import { Canal } from '../../domain/value-objects/canal.js';
import { Criticidade } from '../../domain/value-objects/criticidade.js';
import { NotificacaoEnviada } from '../events.js';
import type {
  AlertaRepository,
  ClienteFinalGateway,
  EventPublisher,
  IdProvider,
  NotificacaoRepository,
  Notifier,
  PreferenciaRepository,
} from '../ports.js';

export interface NotificarAlertaInput {
  alertaId: AlertaId;
  clienteFinalId: ClienteFinalId;
  tenantId: TenantId;
}

/**
 * Entrega uma notificação imediata para um alerta gerado.
 * Trigger: evento `alerta.gerado` (fila) — A03 §3.
 * Resolve usuário/e-mail a partir de clienteFinalId via ClienteFinalGateway (P-83).
 * MVP: 1 usuário por clienteFinal (P-25); desenho suporta fan-out multi-usuário no Next.
 * Idempotente: `jaNotificado` impede reprocessamento de mensagem duplicada.
 */
export class NotificarAlertaUseCase {
  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    private readonly notificacoes: NotificacaoRepository,
    private readonly notifier: Notifier,
    private readonly eventos: EventPublisher,
    private readonly ids: IdProvider,
    private readonly clienteFinalGateway: ClienteFinalGateway,
  ) {}

  async executar(input: NotificarAlertaInput, signal: AbortSignal): Promise<void> {
    const clienteFinal = await this.clienteFinalGateway.porId(input.clienteFinalId, signal);
    if (!clienteFinal) return;

    if (await this.notificacoes.jaNotificado(input.alertaId, clienteFinal.usuarioId, signal)) return;

    const [alerta, preferencia] = await Promise.all([
      this.alertas.porId(input.alertaId, signal),
      this.preferencias.porUsuario(clienteFinal.usuarioId, signal),
    ]);

    if (!alerta) return;

    const criticidade = Criticidade.criar(alerta.diasAtePrazo);

    if (!criticidade.exigeImediato && preferencia?.frequencia !== 'IMEDIATA') return;

    const canal = Canal.criar(preferencia?.canais[0] ?? 'EMAIL');
    let notificacao = Notificacao.criar({
      id: NotificacaoId(this.ids.gerar()),
      tenantId: input.tenantId,
      usuarioId: clienteFinal.usuarioId,
      alertaId: input.alertaId,
      canal,
    });

    try {
      await this.notifier.enviar({
        canal,
        destinatario: clienteFinal.email,
        assunto: `Novo alerta: ${alerta.objeto}`,
        corpo: montarCorpoAlerta(alerta),
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
  }
}

function montarCorpoAlerta(alerta: {
  objeto: string;
  orgao: string;
  uf: string | null;
  prazoProposta: Date | null;
  aderencia: number;
}): string {
  const prazo = alerta.prazoProposta
    ? alerta.prazoProposta.toLocaleDateString('pt-BR')
    : 'não informado';
  return [
    `Objeto: ${alerta.objeto}`,
    `Órgão: ${alerta.orgao}${alerta.uf ? ` (${alerta.uf})` : ''}`,
    `Prazo da proposta: ${prazo}`,
    `Aderência estimada: ${(alerta.aderencia * 100).toFixed(0)}%`,
  ].join('\n');
}
