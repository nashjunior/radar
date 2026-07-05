import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError } from '@radar/kernel';
import { DefinirPreferenciasNotificacaoUseCase } from '../../application/use-cases/definir-preferencias-notificacao.js';
import { CanalInvalidoError } from '../../domain/errors/index.js';
import type { PreferenciaRepository } from '../../application/ports.js';
import { UsuarioId } from '../../domain/entities/notificacao.js';

const noop = new AbortController().signal;

function criarRepo(): PreferenciaRepository {
  return {
    salvar: vi.fn().mockResolvedValue(undefined),
    porUsuario: vi.fn(),
  };
}

describe('DefinirPreferenciasNotificacaoUseCase', () => {
  /**
   * TC-AB1 (A07 §2.1 / A16 §5): autorização por objeto.
   * chamadorId diferente do usuarioId deve ser rejeitado.
   */
  describe('TC-AB1 — autorização por objeto', () => {
    it('lança AcessoNegadoError quando chamadorId diverge do usuarioId', async () => {
      const uc = new DefinirPreferenciasNotificacaoUseCase(criarRepo());

      await expect(
        uc.executar(
          { usuarioId: UsuarioId('usuario-A'), chamadorId: UsuarioId('usuario-B'), canais: ['EMAIL'], frequencia: 'DIARIA' },
          noop,
        ),
      ).rejects.toThrow(AcessoNegadoError);
    });

    it('o erro tem code ACESSO_NEGADO', async () => {
      const uc = new DefinirPreferenciasNotificacaoUseCase(criarRepo());

      try {
        await uc.executar(
          { usuarioId: UsuarioId('usuario-A'), chamadorId: UsuarioId('outro'), canais: ['EMAIL'], frequencia: 'DIARIA' },
          noop,
        );
      } catch (e) {
        expect((e as AcessoNegadoError).code).toBe('ACESSO_NEGADO');
      }
    });

    it('não salva preferência quando chamadorId diverge', async () => {
      const repo = criarRepo();
      const uc = new DefinirPreferenciasNotificacaoUseCase(repo);

      await uc.executar(
        { usuarioId: UsuarioId('usuario-A'), chamadorId: UsuarioId('outro'), canais: ['EMAIL'], frequencia: 'DIARIA' },
        noop,
      ).catch(() => {});

      expect(repo.salvar).not.toHaveBeenCalled();
    });
  });

  describe('caminho feliz', () => {
    it('persiste preferências quando chamadorId coincide com usuarioId', async () => {
      const repo = criarRepo();
      const uc = new DefinirPreferenciasNotificacaoUseCase(repo);

      const resultado = await uc.executar(
        { usuarioId: UsuarioId('usuario-A'), chamadorId: UsuarioId('usuario-A'), canais: ['EMAIL'], frequencia: 'DIARIA' },
        noop,
      );

      expect(repo.salvar).toHaveBeenCalledOnce();
      expect(resultado.canais).toEqual(['EMAIL']);
      expect(resultado.frequencia).toBe('DIARIA');
    });

    it('lança CanalInvalidoError para canal desconhecido', async () => {
      const uc = new DefinirPreferenciasNotificacaoUseCase(criarRepo());

      await expect(
        uc.executar(
          { usuarioId: UsuarioId('u'), chamadorId: UsuarioId('u'), canais: ['SMS'], frequencia: 'DIARIA' },
          noop,
        ),
      ).rejects.toThrow(CanalInvalidoError);
    });
  });
});
