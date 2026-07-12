import type { AlertaId, ClienteFinalId, TenantId } from '@radar/kernel';
import { Canal } from '../../domain/value-objects/canal.js';
import {
  Criticidade,
  LIMIARES_CRITICIDADE_PADRAO,
  type LimiaresCriticidade,
} from '../../domain/value-objects/criticidade.js';
import { EnvioNotificacaoService } from '../services/envio-notificacao-service.js';
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
  /** `occurredAt` do `alerta.gerado` consumido — origem do SLO de entrega imediata (A18 §5). */
  alertaGeradoEm: Date;
}

/**
 * Entrega uma notificação imediata para um alerta gerado.
 * Trigger: evento `alerta.gerado` (fila) — A03 §3.
 * Resolve usuário/e-mail a partir de clienteFinalId via ClienteFinalGateway (P-83).
 * MVP: 1 usuário por clienteFinal (P-25); desenho suporta fan-out multi-usuário no Next.
 * Idempotente: `jaNotificado` impede reprocessamento de mensagem duplicada.
 */
export class NotificarAlertaUseCase {
  private readonly envio: EnvioNotificacaoService;

  constructor(
    private readonly alertas: AlertaRepository,
    private readonly preferencias: PreferenciaRepository,
    private readonly notificacoes: NotificacaoRepository,
    notifier: Notifier,
    eventos: EventPublisher,
    ids: IdProvider,
    private readonly clienteFinalGateway: ClienteFinalGateway,
    private readonly limiares: LimiaresCriticidade = LIMIARES_CRITICIDADE_PADRAO,
  ) {
    this.envio = new EnvioNotificacaoService(notificacoes, notifier, eventos, ids);
  }

  async executar(input: NotificarAlertaInput, signal: AbortSignal): Promise<void> {
    const clienteFinal = await this.clienteFinalGateway.porId(input.clienteFinalId, signal);
    if (!clienteFinal) return;

    if (await this.notificacoes.jaNotificado(input.alertaId, clienteFinal.usuarioId, signal)) return;

    const [alerta, preferencia] = await Promise.all([
      this.alertas.porId(input.alertaId, signal),
      this.preferencias.porUsuario(clienteFinal.usuarioId, signal),
    ]);

    if (!alerta) return;

    const criticidade = Criticidade.deAlerta(alerta, this.limiares);

    if (!criticidade.exigeImediato && preferencia?.frequencia !== 'IMEDIATA') return;

    const canal = Canal.criar(preferencia?.canais[0] ?? 'EMAIL');

    await this.envio.enviarComRegistro(
      {
        tenantId: input.tenantId,
        usuarioId: clienteFinal.usuarioId,
        alertaId: input.alertaId,
        canal,
        destinatario: clienteFinal.email,
        assunto: `Novo alerta: ${alerta.objeto}`,
        corpo: montarCorpoAlerta(alerta),
        alertaGeradoEm: input.alertaGeradoEm,
      },
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
