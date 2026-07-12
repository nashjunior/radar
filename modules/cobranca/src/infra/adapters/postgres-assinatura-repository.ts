import { TenantId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import type { EstadoAssinatura } from '../../domain/entities/assinatura.js';
import type { AssinaturaRepository } from '../../application/ports.js';

interface Row {
  tenant_id: string;
  status: string;
  plano_codigo: string;
  cota_triagens_mes: number;
  preco_centavos: number;
  uso_reservado: number;
  uso_confirmado: number;
  periodo_inicio: Date | string;
  periodo_fim: Date | string;
  assinatura_externa_id: string | null;
}

/**
 * Implementação Postgres de `AssinaturaRepository` (RAD-246). `reservarCota` e
 * `liberarReserva` são as únicas operações do gate de entitlement — cada uma um
 * único `UPDATE`, sem read-modify-write nem transação de duas etapas (P-107 (3)):
 * a decisão sob concorrência é do banco, nunca deste adapter.
 */
export class PostgresAssinaturaRepository implements AssinaturaRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * `WHERE status IN ('ativa','trial') AND uso_reservado < cota_triagens_mes` —
   * trial também passa no gate (é a janela dos 14 dias sem cartão, P-107 (9)).
   * `RETURNING 1` só para detectar `rows.length` — o valor em si é descartável.
   */
  async reservarCota(tenantId: TenantId, signal: AbortSignal): Promise<boolean> {
    const { rows } = await this.db.query<{ ok: number }>(
      `UPDATE assinatura
          SET uso_reservado = uso_reservado + 1
        WHERE tenant_id = $1
          AND status IN ('ativa', 'trial')
          AND uso_reservado < cota_triagens_mes
        RETURNING 1 AS ok`,
      [tenantId],
      { signal },
    );
    return rows.length > 0;
  }

  /** Nunca deixa `uso_reservado` negativo — compensação idempotente (P-107 (c)). */
  async liberarReserva(tenantId: TenantId, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `UPDATE assinatura
          SET uso_reservado = GREATEST(uso_reservado - 1, 0)
        WHERE tenant_id = $1`,
      [tenantId],
      { signal },
    );
  }

  /**
   * Converte 1 unidade de reserva em uso confirmado (RAD-247, consumidor de
   * `triagem.concluida`). `GREATEST` no decremento pela mesma razão de
   * `liberarReserva`: nunca deixar `uso_reservado` negativo se este método for
   * chamado fora de ordem em algum cenário de teste/replay não previsto.
   */
  async confirmarUso(tenantId: TenantId, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `UPDATE assinatura
          SET uso_confirmado = uso_confirmado + 1,
              uso_reservado  = GREATEST(uso_reservado - 1, 0)
        WHERE tenant_id = $1`,
      [tenantId],
      { signal },
    );
  }

  async porTenantId(tenantId: TenantId, signal: AbortSignal): Promise<Assinatura | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT tenant_id, status, plano_codigo, cota_triagens_mes, preco_centavos,
              uso_reservado, uso_confirmado, periodo_inicio, periodo_fim, assinatura_externa_id
         FROM assinatura
        WHERE tenant_id = $1`,
      [tenantId],
      { signal },
    );
    const row = rows[0];
    return row ? rowParaAssinatura(row) : null;
  }

  /** Mapeamento inverso do webhook (P-107 (5), RAD-250) — nunca deriva tenant do payload do provedor. */
  async porAssinaturaExternaId(assinaturaExternaId: string, signal: AbortSignal): Promise<Assinatura | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT tenant_id, status, plano_codigo, cota_triagens_mes, preco_centavos,
              uso_reservado, uso_confirmado, periodo_inicio, periodo_fim, assinatura_externa_id
         FROM assinatura
        WHERE assinatura_externa_id = $1`,
      [assinaturaExternaId],
      { signal },
    );
    const row = rows[0];
    return row ? rowParaAssinatura(row) : null;
  }

  async salvar(assinatura: Assinatura, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO assinatura
         (tenant_id, status, plano_codigo, cota_triagens_mes, preco_centavos,
          uso_reservado, uso_confirmado, periodo_inicio, periodo_fim, assinatura_externa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id) DO UPDATE SET
         status                = EXCLUDED.status,
         plano_codigo          = EXCLUDED.plano_codigo,
         cota_triagens_mes     = EXCLUDED.cota_triagens_mes,
         preco_centavos        = EXCLUDED.preco_centavos,
         uso_reservado         = EXCLUDED.uso_reservado,
         uso_confirmado        = EXCLUDED.uso_confirmado,
         periodo_inicio        = EXCLUDED.periodo_inicio,
         periodo_fim           = EXCLUDED.periodo_fim,
         assinatura_externa_id = EXCLUDED.assinatura_externa_id`,
      [
        assinatura.tenantId,
        assinatura.estado,
        assinatura.plano.codigo,
        assinatura.plano.cota.valor,
        assinatura.plano.precoCentavos,
        assinatura.usoReservado,
        assinatura.usoConfirmado,
        assinatura.cicloVigente.inicio,
        assinatura.cicloVigente.fim,
        assinatura.assinaturaExternaId,
      ],
      { signal },
    );
  }
}

function rowParaAssinatura(row: Row): Assinatura {
  return Assinatura.criar({
    tenantId: TenantId(row.tenant_id),
    estado: row.status as EstadoAssinatura,
    plano: PlanoComercial.criar({
      codigo: row.plano_codigo,
      cotaTriagensMes: row.cota_triagens_mes,
      precoCentavos: row.preco_centavos,
    }),
    cicloVigente: CicloDeFaturamento.criar(new Date(row.periodo_inicio), new Date(row.periodo_fim)),
    usoReservado: row.uso_reservado,
    usoConfirmado: row.uso_confirmado,
    assinaturaExternaId: row.assinatura_externa_id,
  });
}
