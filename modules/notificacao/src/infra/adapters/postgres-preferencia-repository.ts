import type { DbClient } from '@radar/kernel';
import type { CanalTipo, FrequenciaTipo } from '../../domain/index.js';
import type { UsuarioId } from '../../domain/entities/notificacao.js';
import type { PreferenciaDTO } from '../../application/dtos.js';
import type { PreferenciaRepository } from '../../application/ports.js';

export class PostgresPreferenciaRepository implements PreferenciaRepository {
  constructor(private readonly db: DbClient) {}

  async porUsuario(
    id: UsuarioId,
    signal: AbortSignal,
  ): Promise<PreferenciaDTO | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM usuario_preferencia WHERE usuario_id = $1`,
      [id],
      { signal },
    );
    const row = rows[0];
    return row
      ? {
          usuarioId: row.usuario_id as UsuarioId,
          canais: row.canais as CanalTipo[],
          frequencia: row.frequencia as FrequenciaTipo,
        }
      : null;
  }

  async salvar(preferencia: PreferenciaDTO, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO usuario_preferencia (usuario_id, canais, frequencia, atualizada_em)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (usuario_id) DO UPDATE SET
         canais       = EXCLUDED.canais,
         frequencia   = EXCLUDED.frequencia,
         atualizada_em = NOW()`,
      [preferencia.usuarioId, preferencia.canais, preferencia.frequencia],
      { signal },
    );
  }
}

interface Row {
  usuario_id: string;
  canais: string[];
  frequencia: string;
}
