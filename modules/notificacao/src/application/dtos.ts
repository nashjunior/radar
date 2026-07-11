import type { AlertaId, CriterioId } from '@radar/kernel';
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
  /** [0,1] — usado no cálculo de criticidade (P-81) e na ordenação anti-fadiga do digest. */
  aderencia: number;
  /** dias corridos até o prazo da proposta — para cálculo de criticidade. */
  diasAtePrazo: number;
  /** Chave do agrupamento do excedente do digest (P-81) — ver ExcedenteAgrupadoDTO. */
  criterioId: CriterioId;
  criterioNome: string;
  /** Proveniência do edital — disponível quando a view SQL inclui a join com proveniencias (RAD-115). */
  proveniencia?: { fonte: string; baseLegal: string; dataColeta: string };
}

/** Excedente do cap do digest, agregado por critério/órgão (nunca item a item — P-81, docs/11 §4). */
export interface ExcedenteAgrupadoDTO {
  criterioId: CriterioId;
  criterioNome: string;
  orgao: string;
  quantidade: number;
}

/**
 * Retorno de `AlertaRepository.pendentesDigest` (P-81, docs/11 §4 · arquitetura/14 §3).
 * `selecionados` já vem ordenado (prazo asc, aderência desc) e respeitando `limite`;
 * `excedentes` é o que passou do cap, agregado; `totalPendentes` = selecionados + excedentes.
 */
export interface DigestPendentesDTO {
  selecionados: AlertaResumoDTO[];
  excedentes: ExcedenteAgrupadoDTO[];
  totalPendentes: number;
}

export interface PreferenciaDTO {
  usuarioId: UsuarioId;
  canais: CanalTipo[];
  frequencia: FrequenciaTipo;
}

export interface DigestDTO {
  enviados: number;
  agrupados: number;
  total: number;
}
