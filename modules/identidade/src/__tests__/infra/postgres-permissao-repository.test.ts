import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, TenantId } from '@radar/kernel';
import { PostgresPermissaoRepository } from '../../infra/adapters/postgres-permissao-repository.js';
import { AtribuicaoPapel, UsuarioId } from '../../domain/atribuicao-papel.js';
import { UsuarioJaVinculadoError } from '../../domain/errors.js';

const SIGNAL = new AbortController().signal;

describe('PostgresPermissaoRepository', () => {
  it('criar: INSERT ON CONFLICT (sub) DO NOTHING retorna 1 linha ⇒ sucesso', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const repo = new PostgresPermissaoRepository({ query });
    const atribuicao = AtribuicaoPapel.criar({
      usuarioId: UsuarioId('sub-1'),
      tenantId: TenantId('tenant-1'),
      papel: 'ADMIN_CONSULTORIA',
      clienteFinalIds: [],
    });

    await repo.criar(atribuicao, SIGNAL);

    const [sql, params, opts] = query.mock.calls[0]!;
    const texto = String(sql).replace(/\s+/g, ' ');
    expect(texto).toContain('INSERT INTO atribuicao_papel');
    expect(texto).toContain('ON CONFLICT (sub) DO NOTHING');
    expect(params).toEqual(['sub-1', 'tenant-1', 'ADMIN_CONSULTORIA', []]);
    expect(opts).toEqual({ signal: SIGNAL });
  });

  it('criar: 0 linhas afetadas (sub já vinculado) ⇒ UsuarioJaVinculadoError', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresPermissaoRepository({ query });
    const atribuicao = AtribuicaoPapel.criar({
      usuarioId: UsuarioId('sub-1'),
      tenantId: TenantId('tenant-1'),
      papel: 'ADMIN_CONSULTORIA',
      clienteFinalIds: [],
    });

    await expect(repo.criar(atribuicao, SIGNAL)).rejects.toThrow(UsuarioJaVinculadoError);
  });

  it('buscarPorUsuario: mapeia a linha para AtribuicaoPapel', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ sub: 'sub-1', tenant_id: 'tenant-1', papel: 'OPERADOR', cliente_final_ids: ['cliente-1'] }],
    });
    const repo = new PostgresPermissaoRepository({ query });

    const atribuicao = await repo.buscarPorUsuario(UsuarioId('sub-1'), { signal: SIGNAL });

    expect(atribuicao?.usuarioId).toBe(UsuarioId('sub-1'));
    expect(atribuicao?.tenantId).toBe(TenantId('tenant-1'));
    expect(atribuicao?.papel).toBe('OPERADOR');
    expect(atribuicao?.clienteFinalIds).toEqual([ClienteFinalId('cliente-1')]);
  });

  it('buscarPorUsuario: null quando não encontrado', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresPermissaoRepository({ query });

    await expect(repo.buscarPorUsuario(UsuarioId('inexistente'), { signal: SIGNAL })).resolves.toBeNull();
  });
});
