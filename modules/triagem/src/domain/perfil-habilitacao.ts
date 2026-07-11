import type { ClienteFinalId, PerfilId } from '@radar/kernel';
import { Aderencia } from './value-objects/aderencia.js';
import { Risco } from './value-objects/risco.js';
import type { CategoriaHabilitacao, Requisito } from './value-objects/requisito.js';
import type { Severidade } from './value-objects/risco.js';

/**
 * Props do perfil já resolvidas em tipos do domínio (branded IDs). A tradução do modelo externo
 * (wire de Identidade, via Cliente-Fornecedor) para estas props é do ACL — o `PerfilHabilitacaoAdapter`
 * (infra) —, não do domínio nem da application (A10 §3, P-83).
 */
export interface PerfilHabilitacaoProps {
  id: PerfilId;
  clienteFinalId: ClienteFinalId;
  habJuridica: readonly string[];
  habFiscal: readonly string[];
  habTecnica: readonly string[];
  habEconomica: readonly string[];
}

/**
 * Modelo LOCAL conformante do Perfil de Habilitação (A17 §3.3). A FONTE DA VERDADE é
 * Identidade & Organização (docs/13 §5, P-43); aqui é uma visão de leitura consumida via
 * Cliente-Fornecedor — a Triagem NÃO possui este agregado, apenas confronta o edital com ele.
 */
export class PerfilHabilitacao {
  private constructor(
    readonly id: PerfilId,
    readonly clienteFinalId: ClienteFinalId, // usado na autorização por objeto (P-51)
    private readonly habJuridica: readonly string[],
    private readonly habFiscal: readonly string[],
    private readonly habTecnica: readonly string[],
    private readonly habEconomica: readonly string[], // campos definidos em docs/12 (P-50)
  ) {}

  static de(p: PerfilHabilitacaoProps): PerfilHabilitacao {
    return new PerfilHabilitacao(
      p.id,
      p.clienteFinalId,
      [...p.habJuridica],
      [...p.habFiscal],
      [...p.habTecnica],
      [...p.habEconomica],
    );
  }

  /**
   * Regra de domínio: confronta o perfil da empresa com os requisitos do edital. Produz aderência
   * [0,1] + a lista de riscos (lacunas de habilitação). Cada risco herda a citação do requisito de
   * origem — sem fonte, não vira afirmação (docs/10 §4). Sem requisitos, aderência é 0 (nada a
   * confrontar não é "apto"; o gate de confiança e o HITL cuidam do resto — A17 §6).
   */
  confrontar(requisitos: readonly Requisito[]): { aderencia: Aderencia; riscos: Risco[] } {
    const possuidos: Record<CategoriaHabilitacao, readonly string[]> = {
      juridica: this.habJuridica,
      fiscal: this.habFiscal,
      tecnica: this.habTecnica,
      economica: this.habEconomica,
    };

    const riscos: Risco[] = [];
    let atendidos = 0;

    for (const req of requisitos) {
      const atende = possuidos[req.categoria].some((h) => atendeRequisito(h, req.descricao));
      if (atende) {
        atendidos++;
      } else {
        riscos.push(
          Risco.criar(`não atende: ${req.descricao}`, severidadeDe(req.categoria), req.citacao),
        );
      }
    }

    const valor = requisitos.length === 0 ? 0 : atendidos / requisitos.length;
    return { aderencia: Aderencia.criar(valor), riscos };
  }
}

/**
 * Correspondência habilitação-possuída × requisito no MVP: normalização + substring nos dois
 * sentidos. A regra semântica real (sinônimos/NLP) é calibrada contra o gold set (A16) —
 * [A VALIDAR] → P-19. Determinística e barata para manter o eval reproduzível.
 */
function atendeRequisito(possuido: string, requisito: string): boolean {
  const a = normalizar(possuido);
  const b = normalizar(requisito);
  if (a.length === 0 || b.length === 0) return false;
  return b.includes(a) || a.includes(b);
}

function normalizar(s: string): string {
  // Remove marcas diacríticas combinantes (U+0300–U+036F) após NFD → "Certidão" ~ "certidao".
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Severidade default da lacuna por categoria. Documental (jurídica/fiscal) tende a inabilitar;
 * técnica/econômica varia por edital. Ajuste fino é [A VALIDAR] → P-19.
 */
function severidadeDe(categoria: CategoriaHabilitacao): Severidade {
  switch (categoria) {
    case 'juridica':
    case 'fiscal':
      return 'alta';
    case 'tecnica':
      return 'media';
    case 'economica':
      return 'baixa';
  }
}
