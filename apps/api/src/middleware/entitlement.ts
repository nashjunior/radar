/**
 * Middleware `entitlement` — gate de cota por reserva síncrona atômica (P-107 (3), RAD-246).
 *
 * Irmão do RBAC (`autorizacao.ts`, P-52): roda DEPOIS do RBAC e ANTES de publicar
 * `triagem.solicitada`, e só nas rotas que consomem cota (hoje: POST
 * /triagem/:editalId/solicitar — nunca nas de leitura/decisão).
 *
 * `tenantId` SEMPRE do claim JWT verificado (`c.get('tenantId')`, derivado em
 * tenant.ts) — nunca de header/body (docs/05 §4, P-51).
 *
 * Rollback (P-107 (c)): se a reserva foi concedida mas a requisição não termina em
 * 202 (editalId inválido, perfil não encontrado, falha ao publicar
 * `triagem.solicitada`...), a reserva é liberada antes de responder — senão a cota
 * vaza e o gate passa a barrar um tenant que não consumiu nada.
 *
 * Refs: docs/12 ERD, docs/13 §3/§4, P-107 (3)/(6)/(c).
 */

import { createMiddleware } from 'hono/factory';
import {
  AssinaturaInativaError,
  AssinaturaNaoEncontradaError,
  CotaExcedidaError,
} from '@radar/cobranca';
import type { LiberarReservaUseCase, ReservarCotaUseCase } from '@radar/cobranca';
import type { TenantId } from '@radar/kernel';
import { redigirParaLog } from '../logging.js';

export interface EntitlementDeps {
  reservarCota: ReservarCotaUseCase;
  liberarReserva: LiberarReservaUseCase;
}

/** Único status de sucesso da rota protegida — qualquer outro libera a reserva. */
const STATUS_SUCESSO = 202;

export function criarEntitlementMiddleware(deps: EntitlementDeps) {
  async function liberarMelhorEsforco(tenantId: TenantId, signal: AbortSignal): Promise<void> {
    try {
      await deps.liberarReserva.executar({ tenantId }, signal);
    } catch (err) {
      // Best-effort: nunca mascara o erro/response original por trás disso.
      console.error('[API] Falha ao liberar reserva de cota (P-107 c):', redigirParaLog(err));
    }
  }

  return createMiddleware(async (c, next) => {
    const tenantId = c.get('tenantId');
    const signal = c.req.raw.signal;

    try {
      await deps.reservarCota.executar({ tenantId }, signal);
    } catch (err) {
      if (err instanceof CotaExcedidaError) {
        return c.json(
          {
            codigo: 'COTA_EXCEDIDA' as const,
            cota: err.cota,
            usado: err.usoReservado,
            upgradeDisponivel: err.upgradeDisponivel,
          },
          402,
        );
      }
      if (err instanceof AssinaturaInativaError || err instanceof AssinaturaNaoEncontradaError) {
        return c.json(
          { codigo: 'ASSINATURA_INATIVA' as const, mensagem: 'Assinatura inativa ou inexistente.' },
          403,
        );
      }
      throw err;
    }

    // Reserva concedida — a partir daqui, qualquer desfecho != 202 precisa liberar.
    try {
      await next();
    } catch (err) {
      await liberarMelhorEsforco(tenantId, signal);
      throw err;
    }

    if (c.res.status !== STATUS_SUCESSO) {
      await liberarMelhorEsforco(tenantId, signal);
    }
  });
}

export type EntitlementMiddleware = ReturnType<typeof criarEntitlementMiddleware>;
