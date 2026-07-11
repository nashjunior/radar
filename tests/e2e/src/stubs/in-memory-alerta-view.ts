import type { AlertaId } from '@radar/kernel';
import type {
  AlertaRepository,
  AlertaResumoDTO,
  DigestPendentesDTO,
  PreferenciaDTO,
} from '@radar/notificacao';
import type { UsuarioId } from '@radar/notificacao';

/**
 * Stub de AlertaRepository para o módulo Notificação no harness E2E.
 * Em produção seria uma view SQL que junta alerta + edital.
 * No harness, o teste pré-popula com os dados que matching produziu.
 */
export class InMemoryAlertaView implements AlertaRepository {
  private readonly store: Map<string, AlertaResumoDTO> = new Map();

  registrar(resumo: AlertaResumoDTO): void {
    this.store.set(resumo.id, resumo);
  }

  async porId(id: AlertaId, _signal: AbortSignal): Promise<AlertaResumoDTO | null> {
    return this.store.get(id) ?? null;
  }

  async pendentesDigest(
    _params: { usuarioId: UsuarioId; aPartirDe: Date; limite: number },
    _signal: AbortSignal,
  ): Promise<DigestPendentesDTO> {
    return { selecionados: [], excedentes: [], totalPendentes: 0 };
  }
}
