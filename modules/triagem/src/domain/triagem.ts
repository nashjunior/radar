import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { Aderencia } from './value-objects/aderencia.js';
import type { Risco } from './value-objects/risco.js';

export type Recomendacao = 'go' | 'no-go';

export interface ReconstituirTriagemProps {
  editalId: EditalId;
  perfilId: PerfilId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  aderencia: Aderencia;
  recomendacao: Recomendacao;
  riscos: readonly Risco[];
}

/**
 * Agregado raiz do contexto Análise & Triagem (docs/13 §3): a ADERÊNCIA da empresa.
 * 1 por (edital × perfil) (P-45), escopado a `tenantId`/`clienteFinalId` (P-49). Imutável.
 *
 * A recomendação go/no-go é SUGESTÃO — a decisão é sempre do usuário (HITL, docs/10 §4).
 */
export class Triagem {
  private constructor(
    readonly editalId: EditalId,
    readonly perfilId: PerfilId,
    readonly tenantId: TenantId, // Shared Kernel — desde o dia 1 (A01 §6)
    readonly clienteFinalId: ClienteFinalId, // segregação por cliente (P-49)
    readonly aderencia: Aderencia,
    readonly recomendacao: Recomendacao,
    readonly riscos: readonly Risco[],
  ) {}

  /**
   * Reconstitui uma triagem já persistida — usado pelo `TriagemRepository` no read path (A17 §4.3).
   * O cálculo da aderência a partir de extração + perfil (`Triagem.avaliar`) é do write path
   * (worker `TriarEditalUseCase`) e entra com o restante do core em RAD-30.
   */
  static reconstituir(p: ReconstituirTriagemProps): Triagem {
    return new Triagem(
      p.editalId,
      p.perfilId,
      p.tenantId,
      p.clienteFinalId,
      p.aderencia,
      p.recomendacao,
      [...p.riscos],
    );
  }
}
