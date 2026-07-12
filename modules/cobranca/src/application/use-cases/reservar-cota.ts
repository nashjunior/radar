import type { TenantId } from '@radar/kernel';
import {
  AssinaturaInativaError,
  AssinaturaNaoEncontradaError,
  CotaExcedidaError,
} from '../../domain/errors/index.js';
import type { AssinaturaRepository } from '../ports.js';

export interface ReservarCotaInput {
  tenantId: TenantId;
}

/**
 * Enforcement síncrono de cota na borda (P-107 (3)) — o gate mora aqui, nunca em
 * `triagem.concluida`: o evento chega segundos-a-minutos depois (worker
 * assíncrono), então um burst passaria a cota inteira antes de qualquer 402.
 *
 * `executar` chama `AssinaturaRepository.reservarCota` — um único UPDATE atômico
 * (`uso_reservado = uso_reservado + 1 WHERE status IN ('ativa','trial') AND
 * uso_reservado < cota_triagens_mes`), sem read-modify-write. A concorrência é
 * resolvida pelo Postgres, não por este use case.
 *
 * 0 linhas afetadas não diz POR QUE. A leitura de apoio (`porTenantId`) abaixo só
 * QUALIFICA o erro que a borda mapeia para 402/403 (RAD-246) — não decide o gate,
 * que já foi decidido pelo UPDATE; uma corrida entre essa leitura e uma mudança de
 * estado concorrente afeta no máximo a mensagem de erro, nunca a contagem de cota.
 */
export class ReservarCotaUseCase {
  constructor(private readonly assinaturas: AssinaturaRepository) {}

  async executar(input: ReservarCotaInput, signal: AbortSignal): Promise<void> {
    const concedida = await this.assinaturas.reservarCota(input.tenantId, signal);
    if (concedida) return;

    const assinatura = await this.assinaturas.porTenantId(input.tenantId, signal);
    if (assinatura === null) {
      throw new AssinaturaNaoEncontradaError(input.tenantId);
    }
    if (assinatura.estado !== 'ativa' && assinatura.estado !== 'trial') {
      throw new AssinaturaInativaError(input.tenantId, assinatura.estado);
    }
    throw new CotaExcedidaError(
      input.tenantId,
      assinatura.usoReservado,
      assinatura.plano.cota.valor,
      assinatura.plano.codigo !== 'pro',
    );
  }
}
