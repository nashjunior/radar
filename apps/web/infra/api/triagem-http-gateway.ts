/**
 * Adapter que implementa TriagemGateway chamando o BFF REST.
 * É o único lugar que conhece a URL do endpoint — a UI nunca sabe.
 * [A VALIDAR] Migrar para gRPC-web quando o backend expuser TriagemService.
 */
import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import { EditalId as mkEditalId, PerfilId as mkPerfilId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';
import type { TriagemViewModel } from '@/domain/triagem-view-model';
import { SessaoExpiradaError } from '@/application/errors';

export class TriagemHttpGateway implements TriagemGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null> {
    const token = await this.getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      `${this.baseUrl}/api/triagem/${encodeURIComponent(input.editalId)}`,
      { headers, signal },
    );

    if (res.status === 401) throw new SessaoExpiradaError();
    if (res.status === 404) return null;
    if (res.status === 403) return null;
    if (!res.ok) throw new Error(`[TriagemHttpGateway] HTTP ${res.status}`);

    const data = (await res.json()) as {
      status: 'processando' | 'concluida' | 'incompleta' | 'falha_ocr' | 'recusada';
      editalId?: string;
      perfilId?: string;
      aderencia?: number;
      recomendacao?: 'go' | 'no-go';
      confiancaIA?: number;
      paginasEdital?: number;
      camposAnalise?: { titulo: string; conteudo: string; fonte: string; estado: 'ok' | 'verificar' }[];
      checklist?: { ok: boolean; texto: string }[];
    };

    if (data.status === 'processando' || data.status === 'falha_ocr' || data.status === 'recusada') {
      return { status: data.status };
    }

    return {
      status: data.status,
      editalId: mkEditalId(data.editalId!),
      perfilId: mkPerfilId(data.perfilId!),
      aderencia: data.aderencia!,
      recomendacao: data.recomendacao!,
      confiancaIA: data.confiancaIA!,
      paginasEdital: data.paginasEdital!,
      camposAnalise: data.camposAnalise!,
      checklist: data.checklist!,
    };
  }

  async solicitar(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<{ editalId: EditalId; estado: 'processando' }> {
    const token = await this.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      `${this.baseUrl}/api/triagem/${encodeURIComponent(input.editalId)}/solicitar`,
      { method: 'POST', headers, signal },
    );

    if (res.status === 401) throw new SessaoExpiradaError();
    if (!res.ok) throw new Error(`[TriagemHttpGateway.solicitar] HTTP ${res.status}`);

    const data = (await res.json()) as { editalId: string; estado: 'processando' };
    return { editalId: mkEditalId(data.editalId), estado: 'processando' };
  }
}
