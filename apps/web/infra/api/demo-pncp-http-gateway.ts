/** Gateway HTTP da demo PNCP + chat (development). */

export interface DemoEditalCard {
  numeroControlePncp: string;
  modalidadeCodigo: number;
  modalidadeNome: string;
  objeto: string;
  orgao: string;
  municipio: string;
  uf: string;
  valorEstimado: number | null;
  prazoProposta: string | null;
  dataPublicacao: string;
  faseAtual: string;
}

export interface DemoEditalDetalhe extends DemoEditalCard {
  orgaoCnpj: string;
  itens: Array<{
    numeroItem: number;
    descricao: string;
    quantidade: number;
    valorUnitarioEstimado: number | null;
  }>;
}

export interface DemoListaResponse {
  coletadoEm: string | null;
  total: number;
  editais: DemoEditalCard[];
}

export class DemoPncpHttpGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async headers(json = false): Promise<Record<string, string>> {
    const token = await this.getToken();
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async listar(opts: { q?: string; refresh?: boolean; signal: AbortSignal }): Promise<DemoListaResponse> {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.refresh) params.set('refresh', '1');
    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/api/demo/editais${qs ? `?${qs}` : ''}`, {
      headers: await this.headers(),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await lerErro(res));
    return (await res.json()) as DemoListaResponse;
  }

  async detalhe(numeroControlePncp: string, signal: AbortSignal): Promise<DemoEditalDetalhe> {
    const res = await fetch(
      `${this.baseUrl}/api/demo/editais/${encodeURIComponent(numeroControlePncp)}`,
      { headers: await this.headers(), signal },
    );
    if (!res.ok) throw new Error(await lerErro(res));
    return (await res.json()) as DemoEditalDetalhe;
  }

  async chat(
    mensagem: string,
    opts: { numeroControlePncp?: string; signal: AbortSignal },
  ): Promise<string> {
    const body: Record<string, string> = { mensagem };
    if (opts.numeroControlePncp) body['numeroControlePncp'] = opts.numeroControlePncp;
    const res = await fetch(`${this.baseUrl}/api/demo/chat`, {
      method: 'POST',
      headers: await this.headers(true),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(await lerErro(res));
    const json = (await res.json()) as { resposta: string };
    return json.resposta;
  }
}

async function lerErro(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { mensagem?: string; code?: string };
    return j.mensagem ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Erros de rede transitórios (API reiniciando) — o UI faz retry silencioso. */
export function ehErroRedeTransitorio(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed|conexão|connection|fetch/i.test(raw);
}

/** Mensagem curta só quando o retry silencioso esgota — sem jargão técnico. */
export function mensagemErroRede(err: unknown): string {
  if (ehErroRedeTransitorio(err)) {
    return 'Atualizando… se a lista não aparecer, clique em “Atualizar PNCP”.';
  }
  if (/aborted|timeout|timed out/i.test(err instanceof Error ? err.message : String(err))) {
    return 'A resposta demorou demais. Tente uma pergunta mais curta.';
  }
  return err instanceof Error ? err.message : String(err);
}
