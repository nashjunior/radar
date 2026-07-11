import { ClienteFinalId, PerfilId } from '@radar/kernel';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import type { PerfilGateway } from '../../application/ports.js';

/**
 * Modelo do Perfil como vem de Identidade & Organização (wire cross-domain). Não vaza além deste
 * adapter — é o ACL do Cliente-Fornecedor (docs/13 §5, P-43).
 */
export interface PerfilSourceData {
  id: string;
  clienteFinalId: string;
  habJuridica: string[];
  habFiscal: string[];
  habTecnica: string[];
  habEconomica: string[];
}

/**
 * Fonte do Perfil em Identidade & Organização. No MVP (monólito modular) é chamada em processo por
 * trás deste port; no *Next*, **gRPC** (A10 §5) via `shared/contracts`. Só a tecnologia muda — o
 * contrato do gateway não.
 */
export interface PerfilSource {
  buscar(id: string, signal: AbortSignal): Promise<PerfilSourceData | null>;
}

/**
 * Implementa o port `PerfilGateway` (decisão P-83: é Gateway, não Repository — a Triagem NÃO possui
 * o Perfil). ACL do Cliente-Fornecedor: traduz o modelo de Identidade para o modelo LOCAL conformante
 * `PerfilHabilitacao` e para por aqui — a Triagem lê, nunca escreve. Os branded IDs (`PerfilId`,
 * `ClienteFinalId`) são construídos AQUI, na infra (ids.ts), fechando a autorização por objeto (P-51).
 */
export class PerfilHabilitacaoAdapter implements PerfilGateway {
  constructor(private readonly fonte: PerfilSource) {}

  async porId(id: PerfilId, signal: AbortSignal): Promise<PerfilHabilitacao | null> {
    const raw = await this.fonte.buscar(id, signal);
    if (raw === null) return null;
    // Branded IDs construídos na infra; `PerfilHabilitacao.de` faz a cópia defensiva dos arrays.
    return PerfilHabilitacao.de({
      id: PerfilId(raw.id),
      clienteFinalId: ClienteFinalId(raw.clienteFinalId),
      habJuridica: raw.habJuridica,
      habFiscal: raw.habFiscal,
      habTecnica: raw.habTecnica,
      habEconomica: raw.habEconomica,
    });
  }
}
