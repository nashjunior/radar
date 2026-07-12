/**
 * Rematch síncrono: critérios ativos × lote PNCP demo → alertas em memória.
 * PNCP lista não traz CNAE: o filtro CNAE do critério não bloqueia (demo).
 */

import type { ContratacaoData } from '@radar/ingestao';
import { Alerta, type CriterioRepository } from '@radar/matching';
import type { TenantId } from '@radar/kernel';
import {
  editalIdDeNumeroControle,
  novoAlertaId,
  type CatalogoMemoria,
} from './matching-memoria-store.js';

export interface RematchDeps {
  criterios: CriterioRepository;
  alertas: {
    limparPorTenant(tenantId: TenantId): void;
    salvar(alerta: Alerta, signal: AbortSignal): Promise<void>;
  };
  catalogo: CatalogoMemoria;
}

/**
 * Regenera alertas do tenant a partir do lote. Retorna quantos alertas foram gravados.
 */
export async function rematchLoteComCriterios(
  lote: readonly ContratacaoData[],
  tenantId: TenantId,
  deps: RematchDeps,
  signal: AbortSignal,
): Promise<number> {
  deps.catalogo.sincronizarDoLote(lote);
  deps.alertas.limparPorTenant(tenantId);

  const criterios = (await deps.criterios.listarAtivos(signal)).filter(
    (c) => c.tenantId === tenantId,
  );
  if (criterios.length === 0) return 0;

  let gerados = 0;
  for (const ed of lote) {
    const editalId = editalIdDeNumeroControle(ed.numeroControlePncp);
    for (const criterio of criterios) {
      const aderencia = criterio.casaCom({
        objetoDescricao: ed.objeto,
        uf: ed.orgao.uf,
        // Lista PNCP não traz CNAE — não bloqueia o match por CNAE na demo.
        cnae: criterio.ramoCnae,
        valorEstimado: ed.valorEstimado,
      });
      if (aderencia === null || !aderencia.superaLimiar) continue;

      const alerta = Alerta.criar({
        id: novoAlertaId(),
        tenantId: criterio.tenantId,
        clienteFinalId: criterio.clienteFinalId,
        criterioId: criterio.id,
        editalId,
        aderencia,
      });
      await deps.alertas.salvar(alerta, signal);
      gerados++;
    }
  }
  return gerados;
}
