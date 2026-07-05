/**
 * Adapter que implementa TriagemGateway chamando o BFF REST.
 * É o único lugar que conhece a URL do endpoint — a UI nunca sabe.
 * [A VALIDAR] Migrar para gRPC-web quando o backend expuser TriagemService.
 */
import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import { EditalId as mkEditalId, PerfilId as mkPerfilId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';
import type { TriagemViewModel } from '@/domain/triagem-view-model';

export class TriagemHttpGateway implements TriagemGateway {
  constructor(private readonly baseUrl: string = '') {}

  async buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null> {
    const res = await fetch(
      `${this.baseUrl}/api/triagem/${encodeURIComponent(input.editalId)}`,
      {
        headers: { 'x-tenant-id': input.tenantId },
        signal,
      },
    );

    if (res.status === 404) return null;
    if (res.status === 403) return null;
    if (!res.ok) throw new Error(`[TriagemHttpGateway] HTTP ${res.status}`);

    const data = (await res.json()) as {
      editalId: string;
      perfilId: string;
      aderencia: number;
      recomendacao: 'go' | 'no-go';
      confiancaIA: number;
      paginasEdital: number;
      camposAnalise: { titulo: string; conteudo: string; fonte: string }[];
      checklist: { ok: boolean; texto: string }[];
    };

    return {
      editalId: mkEditalId(data.editalId),
      perfilId: mkPerfilId(data.perfilId),
      aderencia: data.aderencia,
      recomendacao: data.recomendacao,
      confiancaIA: data.confiancaIA,
      paginasEdital: data.paginasEdital,
      camposAnalise: data.camposAnalise,
      checklist: data.checklist,
    };
  }
}
