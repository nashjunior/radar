/**
 * Adapter que implementa TriagemGateway chamando o BFF REST.
 * É o único lugar que conhece a URL do endpoint — a UI nunca sabe.
 * [A VALIDAR] Migrar para gRPC-web quando o backend expuser TriagemService.
 */
import type { EditalId, PerfilId, TenantId } from '@radar/kernel';
import { EditalId as mkEditalId, PerfilId as mkPerfilId } from '@radar/kernel';
import type { TriagemGateway } from '@/application/ports';
import type { TriagemViewModel } from '@/domain/triagem-view-model';
import { fetchApi } from './http-client';

export class TriagemHttpGateway implements TriagemGateway {
  constructor(
    private readonly baseUrl: string = '',
    private readonly getToken: () => Promise<string | null>,
  ) {}

  async buscarPorEdital(
    input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId },
    signal: AbortSignal,
  ): Promise<TriagemViewModel | null> {
    const res = await fetchApi(
      `${this.baseUrl}/api/triagem/${encodeURIComponent(input.editalId)}`,
      this.getToken,
      { signal, on403: 'null', on404: 'null' },
    );
    if (!res) return null;

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
    const res = await fetchApi(
      `${this.baseUrl}/api/triagem/${encodeURIComponent(input.editalId)}/solicitar`,
      this.getToken,
      { method: 'POST', json: true, signal },
    );
    const data = (await res!.json()) as { editalId: string; estado: 'processando' };
    return { editalId: mkEditalId(data.editalId), estado: 'processando' };
  }

  private async postFeedback(path: string, body: unknown, signal: AbortSignal): Promise<void> {
    await fetchApi(`${this.baseUrl}${path}`, this.getToken, {
      method: 'POST',
      json: true,
      body: JSON.stringify(body),
      signal,
    });
  }

  async aceitar(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId }, signal: AbortSignal): Promise<void> {
    return this.postFeedback(`/api/triagem/${encodeURIComponent(input.editalId)}/aceitar`, {}, signal);
  }

  async contestar(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId; motivo?: string }, signal: AbortSignal): Promise<void> {
    return this.postFeedback(
      `/api/triagem/${encodeURIComponent(input.editalId)}/contestar`,
      { motivo: input.motivo ?? null },
      signal,
    );
  }

  async registrarDecisao(input: { tenantId: TenantId; editalId: EditalId; perfilId: PerfilId; go: boolean }, signal: AbortSignal): Promise<void> {
    return this.postFeedback(
      `/api/triagem/${encodeURIComponent(input.editalId)}/decisao`,
      { go: input.go },
      signal,
    );
  }
}
