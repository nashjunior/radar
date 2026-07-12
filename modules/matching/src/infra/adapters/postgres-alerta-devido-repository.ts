import type { AlertaId, DbClient } from '@radar/kernel';
import type { AlertaDevidoRegistro, AlertaDevidoRepository } from '../../application/ports.js';

/**
 * Projeção de alertas devidos (P-114, A18 §5.2). INSERT direto no schema do Matching —
 * nunca pela FilaAlertaPort. Um único INSERT multi-linha por edital (P-41/RAD-179).
 */
export class PostgresAlertaDevidoRepository implements AlertaDevidoRepository {
  constructor(private readonly db: DbClient) {}

  async registrarLote(devidos: AlertaDevidoRegistro[], signal: AbortSignal): Promise<void> {
    if (devidos.length === 0) return;

    const COLUNAS = 5;
    const values: unknown[] = [];
    const placeholders = devidos.map((d, i) => {
      const base = i * COLUNAS;
      values.push(d.alertaId, d.editalId, d.criterioId, d.tenantId, d.prazoProposta);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},NOW())`;
    });

    await this.db.query(
      `INSERT INTO alerta_devido
         (alerta_id, edital_id, criterio_id, tenant_id, prazo_proposta, devido_em)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (alerta_id) DO NOTHING`,
      values,
      { signal },
    );
  }

  /**
   * Perna `coberto` (P-114, A18 §5.2) — `AND notificado_em IS NULL` dá a idempotência: a
   * primeira entrega grava o instante, reentregas da mesma mensagem (ou do mesmo alerta por
   * um segundo canal) não sobrescrevem. Sem linha para `alertaId` ⇒ UPDATE afeta 0 linhas,
   * sem erro — é o caso de edital sem `prazoProposta` (nenhuma obrigação foi registrada).
   */
  async marcarNotificado(alertaId: AlertaId, notificadoEm: Date, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `UPDATE alerta_devido SET notificado_em = $1 WHERE alerta_id = $2 AND notificado_em IS NULL`,
      [notificadoEm, alertaId],
      { signal },
    );
  }
}
