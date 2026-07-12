import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { Assinatura } from '../../domain/entities/assinatura.js';
import { RegistroDeUso } from '../../domain/entities/registro-de-uso.js';
import { AssinaturaNaoEncontradaError } from '../../domain/errors/index.js';
import { CotaAlertaAtingida } from '../events.js';
import type { AssinaturaRepository, EventPublisher, IdProvider, RegistroDeUsoRepository } from '../ports.js';

export interface ConfirmarUsoInput {
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  editalId: EditalId;
  perfilId: PerfilId;
  /** Momento em que `triagem.concluida` foi recebido — define o período de faturamento (AAAA-MM). */
  confirmadoEm: Date;
}

/** Ordem decrescente: só o limiar mais alto já atingido dispara (evita alerta duplo 80%+100% no mesmo confirm). */
const LIMIARES_ALERTA_COTA = [100, 80] as const;

/**
 * Consumidor de `triagem.concluida` (arquitetura/03 §3) — RAD-247. Converte a
 * reserva de cota em uso confirmado e grava a linha faturável de `RegistroDeUso`.
 *
 * Idempotente por design (P-107 (4)): `RegistroDeUsoRepository.registrar` faz
 * `INSERT ... ON CONFLICT DO NOTHING` pela chave natural + período. SQS é
 * *at-least-once* e o evento não carrega `eventId` — a mesma triagem pode chegar
 * 2x (duplo clique de `SolicitarTriagem`/`TriarEdital`). Em 0 linhas inseridas,
 * este use case **não** mexe no agregado e encerra com sucesso — não é erro, é o
 * caminho normal do replay.
 */
export class ConfirmarUsoUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly registros: RegistroDeUsoRepository,
    private readonly ids: IdProvider,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: ConfirmarUsoInput, signal: AbortSignal): Promise<void> {
    const assinatura = await this.assinaturas.porTenantId(input.tenantId, signal);
    if (!assinatura) throw new AssinaturaNaoEncontradaError(input.tenantId);

    const registro = RegistroDeUso.criar({
      id: this.ids.gerar(),
      tenantId: input.tenantId,
      clienteFinalId: input.clienteFinalId,
      editalId: input.editalId,
      perfilId: input.perfilId,
      periodo: formatarPeriodo(input.confirmadoEm),
      confirmadoEm: input.confirmadoEm,
    });

    const inserido = await this.registros.registrar(registro, signal);
    if (!inserido) return; // duplo-clique/replay — já confirmado, nada a fazer (P-107 (4))

    await this.assinaturas.confirmarUso(input.tenantId, signal);
    await this.avisarSeCotaCritica(assinatura, signal);
  }

  /**
   * `confirmarUso` só troca reservado↔confirmado — o TOTAL consumido não muda
   * neste passo (mudou na reserva, RAD-246). Por isso o percentual é calculado a
   * partir da `Assinatura` lida ANTES da confirmação: é o mesmo valor de depois.
   */
  private async avisarSeCotaCritica(assinatura: Assinatura, signal: AbortSignal): Promise<void> {
    const cota = assinatura.plano.cota.valor;
    const usoAtual = assinatura.usoReservado + assinatura.usoConfirmado;
    const percentual = (usoAtual / cota) * 100;
    const limiarAtingido = LIMIARES_ALERTA_COTA.find(limiar => percentual >= limiar);
    if (limiarAtingido === undefined) return;

    await this.eventos.publicar(
      new CotaAlertaAtingida({
        tenantId: assinatura.tenantId,
        percentual: limiarAtingido,
        usoAtual,
        cota,
      }),
      signal,
    );
  }
}

function formatarPeriodo(data: Date): string {
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}
