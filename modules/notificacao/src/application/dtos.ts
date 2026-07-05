import type { AlertaId } from '@radar/kernel';
import type { CanalTipo, FrequenciaTipo } from '../domain/index.js';
import type { UsuarioId } from '../domain/entities/notificacao.js';

/** Dados do cliente final resolvidos pelo ClienteFinalGateway (MVP: 1 usuário por clienteFinal — P-25). */
export interface ClienteFinalDTO {
  usuarioId: UsuarioId;
  email: string;
}

/** Resumo de alerta usado pela Notificação para montar o corpo da mensagem. */
export interface AlertaResumoDTO {
  id: AlertaId;
  objeto: string;
  orgao: string;
  uf: string | null;
  prazoProposta: Date | null;
  /** [0,1] — usado para ordenação anti-fadiga no digest. */
  aderencia: number;
  /** dias corridos até o prazo da proposta — para cálculo de criticidade. */
  diasAtePrazo: number;
}

export interface PreferenciaDTO {
  usuarioId: UsuarioId;
  canais: CanalTipo[];
  frequencia: FrequenciaTipo;
}

export interface DigestDTO {
  enviados: number;
  agrupados: number;
}
