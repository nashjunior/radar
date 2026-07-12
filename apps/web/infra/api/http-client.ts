import { SessaoExpiradaError, AcessoNegadoError, CotaExcedidaError } from '@/application/errors';

export interface FetchApiOptions extends Omit<RequestInit, 'headers'> {
  /** Add Content-Type: application/json. Use for POST/PUT/PATCH with a JSON body. */
  json?: boolean;
  /** Behavior on HTTP 403. Default: throw AcessoNegadoError. */
  on403?: 'throw' | 'null';
  /** Behavior on HTTP 404. Default: throw generic error. */
  on404?: 'throw' | 'null';
}

/**
 * Shared fetch helper for apps/web HTTP gateways.
 * Injects Authorization header and maps 401/402/403/404/!ok to typed errors.
 * Returns the raw Response on success, or null when on403/on404 is 'null'.
 * HTTP 402 always throws CotaExcedidaError (parseia o corpo JSON { cota, usado, upgradeDisponivel }).
 */
export async function fetchApi(
  url: string,
  getToken: () => Promise<string | null>,
  options: FetchApiOptions = {},
): Promise<Response | null> {
  const { json = false, on403 = 'throw', on404 = 'throw', ...rest } = options;

  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...rest, headers });

  if (res.status === 401) throw new SessaoExpiradaError();
  if (res.status === 402) {
    const body = (await res.json()) as { cota?: number; usado?: number; upgradeDisponivel?: boolean };
    throw new CotaExcedidaError(body.cota ?? 0, body.usado ?? 0, body.upgradeDisponivel ?? false);
  }
  if (res.status === 403) {
    if (on403 === 'null') return null;
    throw new AcessoNegadoError();
  }
  if (res.status === 404) {
    if (on404 === 'null') return null;
    throw new Error(`HTTP 404: ${url}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

  return res;
}
