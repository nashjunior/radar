import type { ContratacaoData } from '@radar/ingestao';

export interface FiltroDemo {
  readonly palavrasChave: readonly string[];
  readonly uf: string | null;
  readonly valorMax: number | null;
}

/** Matching mínimo in-memory (demo) — não substitui o módulo Matching. */
export function filtrarContratacoes(
  itens: readonly ContratacaoData[],
  filtro: FiltroDemo,
): ContratacaoData[] {
  return itens.filter((c) => {
    if (filtro.uf && c.orgao.uf.toUpperCase() !== filtro.uf.toUpperCase()) return false;
    if (filtro.valorMax !== null && c.valorEstimado !== null && c.valorEstimado > filtro.valorMax) {
      return false;
    }
    if (filtro.palavrasChave.length === 0) return true;
    const hay = normalizar(
      [c.objeto, c.orgao.nome, ...c.itens.map((i) => i.descricao)].join(' '),
    );
    return filtro.palavrasChave.some((p) => hay.includes(normalizar(p)));
  });
}

export function lerFiltroDoEnv(env: NodeJS.ProcessEnv = process.env): FiltroDemo {
  const rawKw = env['DEMO_PALAVRAS_CHAVE']?.trim() ?? '';
  const palavrasChave = rawKw
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const uf = env['DEMO_UF']?.trim() || null;
  const valorRaw = env['DEMO_VALOR_MAX']?.trim();
  const valorMax =
    valorRaw && Number.isFinite(Number(valorRaw)) ? Number(valorRaw) : null;
  return { palavrasChave, uf, valorMax };
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
