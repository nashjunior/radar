import { AcessoNegadoError } from '@radar/kernel';
import { Canal } from '../../domain/value-objects/canal.js';
import { Frequencia } from '../../domain/value-objects/frequencia.js';
import type { PreferenciaDTO } from '../dtos.js';
import type { PreferenciaRepository } from '../ports.js';
import type { UsuarioId } from '../../domain/entities/notificacao.js';

export interface DefinirPreferenciasInput {
  usuarioId: UsuarioId;
  /** ID do chamador — autorização por objeto (P-51). */
  chamadorId: UsuarioId;
  canais: string[];
  frequencia: string;
}

/**
 * Define (ou atualiza) as preferências de notificação do usuário.
 * Trigger: usuário via API.
 * Autorização por objeto: chamadorId deve coincidir com usuarioId (P-51).
 */
export class DefinirPreferenciasNotificacaoUseCase {
  constructor(private readonly preferencias: PreferenciaRepository) {}

  async executar(
    input: DefinirPreferenciasInput,
    signal: AbortSignal,
  ): Promise<PreferenciaDTO> {
    if (input.chamadorId !== input.usuarioId) throw new AcessoNegadoError();

    const canais = input.canais.map(c => Canal.criar(c));
    const frequencia = Frequencia.criar(input.frequencia);

    const dto: PreferenciaDTO = {
      usuarioId: input.usuarioId,
      canais: canais.map(c => c.tipo),
      frequencia: frequencia.tipo,
    };

    await this.preferencias.salvar(dto, signal);
    return dto;
  }
}
