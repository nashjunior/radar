/**
 * Adapter MVP de PermissaoRepository (P-52) — backed em config/seed.
 *
 * Enquanto a administração de usuários/papéis não existe (docs/14 §6: "não é
 * pré-requisito da checagem"), a atribuição usuarioId→{tenantId,papel,
 * clienteFinalIds[]} vem de uma variável de ambiente PERMISSAO_SEED (JSON),
 * chaveada pelo `sub` verificado do IdP — nunca por header ou input do
 * cliente. Quando a administração vier, troca-se só este adapter — o port
 * não muda (mesmo padrão do perfil-ativo-config-adapter, P-90).
 *
 * Formato de PERMISSAO_SEED:
 *   { "<usuarioId>": { "tenantId": "...", "papel": "ADMIN_CONSULTORIA" | "OPERADOR" |
 *                       "CLIENTE_FINAL_READONLY" | "DPO_COMPLIANCE",
 *                       "clienteFinalIds": ["..."] }, ... }
 *
 * Sem entrada para o usuarioId ⇒ null — ResolverContextoAutorizacaoUseCase
 * traduz para AcessoNegadoError/403 (nunca 500, nunca "passa").
 * Nunca hardcode valores — provisionado junto do usuário (env/config file).
 * AbortSignal propagado (P-78); lookup síncrono não I/O, mas checamos
 * o abort antes de retornar.
 *
 * Refs: docs/98 P-90 (padrão do adapter), docs/14 §6, docs/05 §4, RAD-212.
 */

import { ClienteFinalId, TenantId } from '@radar/kernel';
import { AtribuicaoPapel, UsuarioId } from '@radar/identidade';
import type { Papel, PermissaoRepository } from '@radar/identidade';

const PAPEIS_VALIDOS: readonly Papel[] = [
  'ADMIN_CONSULTORIA',
  'OPERADOR',
  'CLIENTE_FINAL_READONLY',
  'DPO_COMPLIANCE',
];

interface EntradaSeed {
  tenantId: string;
  papel: Papel;
  clienteFinalIds: string[];
}

function ehEntradaValida(entrada: unknown): entrada is EntradaSeed {
  if (typeof entrada !== 'object' || entrada === null) return false;
  const e = entrada as Record<string, unknown>;
  return (
    typeof e['tenantId'] === 'string' &&
    e['tenantId'].trim() !== '' &&
    typeof e['papel'] === 'string' &&
    PAPEIS_VALIDOS.includes(e['papel'] as Papel) &&
    Array.isArray(e['clienteFinalIds']) &&
    e['clienteFinalIds'].every((v) => typeof v === 'string')
  );
}

type MapaInterno = ReadonlyMap<string, AtribuicaoPapel>;

export class PermissaoConfigAdapter implements PermissaoRepository {
  private readonly mapa: MapaInterno;

  private constructor(mapa: MapaInterno) {
    this.mapa = mapa;
  }

  static fromJson(json: string): PermissaoConfigAdapter {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error('PERMISSAO_SEED: JSON inválido.');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('PERMISSAO_SEED: deve ser um objeto JSON { usuarioId: { tenantId, papel, clienteFinalIds } }.');
    }

    const mapa = new Map<string, AtribuicaoPapel>();
    for (const [usuarioIdRaw, entrada] of Object.entries(raw as Record<string, unknown>)) {
      if (!ehEntradaValida(entrada)) {
        throw new Error(
          `PERMISSAO_SEED: entrada inválida para usuário "${usuarioIdRaw}". Esperado ` +
            '{ tenantId: string não-vazio, papel: ADMIN_CONSULTORIA|OPERADOR|CLIENTE_FINAL_READONLY|DPO_COMPLIANCE, clienteFinalIds: string[] }.',
        );
      }

      mapa.set(
        usuarioIdRaw,
        AtribuicaoPapel.criar({
          usuarioId: UsuarioId(usuarioIdRaw),
          tenantId: TenantId(entrada.tenantId),
          papel: entrada.papel,
          clienteFinalIds: entrada.clienteFinalIds.map((id) => ClienteFinalId(id)),
        }),
      );
    }

    return new PermissaoConfigAdapter(mapa);
  }

  async buscarPorUsuario(usuarioId: UsuarioId, opts: { signal: AbortSignal }): Promise<AtribuicaoPapel | null> {
    opts.signal.throwIfAborted();
    return this.mapa.get(usuarioId) ?? null;
  }
}
