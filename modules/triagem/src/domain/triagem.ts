import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { ExtracaoEdital } from './extracao-edital.js';
import type { PerfilHabilitacao } from './perfil-habilitacao.js';
import type { Aderencia } from './value-objects/aderencia.js';
import type { Risco } from './value-objects/risco.js';

export type Recomendacao = 'go' | 'no-go';

/**
 * Ciclo de vida do agregado Triagem (RAD-79).
 * - `processando` → solicitada, worker ainda não concluiu
 * - `concluida`   → aderência calculada, full DTO disponível
 * - `incompleta`  → extração abaixo do limiar de confiança (leitura assistida, docs/10 §6)
 * - `falha_ocr`   → texto do edital ilegível (leitura manual, docs/10 §6)
 * - `recusada`    → modelo recusou a extração (stop_reason=refusal — ExtracaoRecusadaError)
 */
export type TriagemStatus = 'processando' | 'concluida' | 'incompleta' | 'falha_ocr' | 'recusada';

export interface ReconstituirTriagemProps {
  editalId: EditalId;
  perfilId: PerfilId;
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  status: TriagemStatus;
  /** Não-null quando status é 'concluida' ou 'incompleta'. */
  aderencia: Aderencia | null;
  /** Não-null quando status é 'concluida'. */
  recomendacao: Recomendacao | null;
  riscos: readonly Risco[];
}

/**
 * Agregado raiz do contexto Análise & Triagem (docs/13 §3): a ADERÊNCIA da empresa.
 * 1 por (edital × perfil) (P-45), escopado a `tenantId`/`clienteFinalId` (P-49). Imutável.
 *
 * A recomendação go/no-go é SUGESTÃO — a decisão é sempre do usuário (HITL, docs/10 §4).
 * O `status` rastreia o ciclo de vida assíncrono (RAD-79): `processando → concluida|incompleta|falha_ocr|recusada`.
 */
export class Triagem {
  private constructor(
    readonly editalId: EditalId,
    readonly perfilId: PerfilId,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId,
    readonly status: TriagemStatus,
    readonly aderencia: Aderencia | null,
    readonly recomendacao: Recomendacao | null,
    readonly riscos: readonly Risco[],
  ) {}

  static reconstituir(p: ReconstituirTriagemProps): Triagem {
    return new Triagem(
      p.editalId, p.perfilId, p.tenantId, p.clienteFinalId,
      p.status, p.aderencia, p.recomendacao, [...p.riscos],
    );
  }

  /**
   * Write path (worker `TriarEditalUseCase`, A17 §4.3): calcula a aderência confrontando os
   * requisitos da extração (catálogo global) com o perfil (por cliente). A `recomendacao` go/no-go
   * é derivada do corte de `Aderencia.ehAlta`, mas é SUGESTÃO — a decisão é sempre do usuário
   * (HITL, docs/10 §4). O `clienteFinalId` vem do perfil, fechando o escopo por objeto (P-49/P-51).
   */
  static avaliar(extracao: ExtracaoEdital, perfil: PerfilHabilitacao, tenantId: TenantId): Triagem {
    const { aderencia, riscos } = perfil.confrontar(extracao.requisitos);
    return new Triagem(
      extracao.editalId, perfil.id, tenantId, perfil.clienteFinalId,
      'concluida', aderencia, aderencia.ehAlta ? 'go' : 'no-go', riscos,
    );
  }

  /** Solicited but worker hasn't run yet (RAD-79). */
  static pendente(
    editalId: EditalId, perfilId: PerfilId, tenantId: TenantId, clienteFinalId: ClienteFinalId,
  ): Triagem {
    return new Triagem(editalId, perfilId, tenantId, clienteFinalId, 'processando', null, null, []);
  }

  /** Extraction was below confidence threshold — partial data shown (RAD-79). */
  static incompleta(
    editalId: EditalId, perfilId: PerfilId, tenantId: TenantId, clienteFinalId: ClienteFinalId,
  ): Triagem {
    return new Triagem(editalId, perfilId, tenantId, clienteFinalId, 'incompleta', null, null, []);
  }

  /** OCR failed — no text available (RAD-79). */
  static falhaOcr(
    editalId: EditalId, perfilId: PerfilId, tenantId: TenantId, clienteFinalId: ClienteFinalId,
  ): Triagem {
    return new Triagem(editalId, perfilId, tenantId, clienteFinalId, 'falha_ocr', null, null, []);
  }

  /** LLM refused to extract (stop_reason=refusal — RAD-79). */
  static recusada(
    editalId: EditalId, perfilId: PerfilId, tenantId: TenantId, clienteFinalId: ClienteFinalId,
  ): Triagem {
    return new Triagem(editalId, perfilId, tenantId, clienteFinalId, 'recusada', null, null, []);
  }
}
