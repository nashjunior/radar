import type { TenantId } from '@radar/kernel';
import {
  AssinaturaInativaError,
  AssinaturaNaoEncontradaError,
  CotaExcedidaError,
} from '../../domain/errors/index.js';
import type { AssinaturaRepository, ClockProvider } from '../ports.js';

export interface ReservarCotaInput {
  tenantId: TenantId;
}

/**
 * Enforcement síncrono de cota na borda (P-107 (3)) — o gate mora aqui, nunca em
 * `triagem.concluida`: o evento chega segundos-a-minutos depois (worker
 * assíncrono), então um burst passaria a cota inteira antes de qualquer 402.
 *
 * `executar` chama `AssinaturaRepository.reservarCota` — um único UPDATE atômico
 * (ver SQL real em `PostgresAssinaturaRepository.reservarCota`: `status IN
 * ('ativa','trial') AND uso_reservado < cota_triagens_mes AND (status <> 'trial'
 * OR periodo_fim > now())`, RAD-277, mais a carência por tempo do ciclo `ativa`
 * vencido, RAD-290), sem read-modify-write. A concorrência é resolvida pelo
 * Postgres, não por este use case.
 *
 * 0 linhas afetadas não diz POR QUE. A leitura de apoio (`porTenantId`) abaixo só
 * QUALIFICA o erro que a borda mapeia para 402/403 (RAD-246) — não decide o gate,
 * que já foi decidido pelo UPDATE; uma corrida entre essa leitura e uma mudança de
 * estado concorrente afeta no máximo a mensagem de erro, nunca a contagem de cota.
 *
 * Trial vencido (RAD-277, P-107 (9)) é a MESMA transição lazy de
 * `ConsultarAssinaturaUseCase`: `cicloVigente.fim` no passado qualifica como
 * `AssinaturaInativaError` (403), nunca `CotaExcedidaError` (402) — mesmo com
 * cota sobrando, o limite do trial é o tempo, não só a contagem. Já um ciclo
 * `ativa` vencido só chega até aqui como erro depois que a carência (RAD-290)
 * se esgota — janela OU teto duro (2x a cota); dentro da carência `concedida`
 * já vem `true` sem passar pela leitura de apoio.
 */
export class ReservarCotaUseCase {
  constructor(
    private readonly assinaturas: AssinaturaRepository,
    private readonly clock: ClockProvider,
  ) {}

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
    if (assinatura.trialVencido(this.clock.agora())) {
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
