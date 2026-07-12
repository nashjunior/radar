/**
 * Cache in-memory do lote PNCP para a demo local (lista + detalhe + chat).
 * NÃO é persistência de produção — só composition root de development.
 */

import type { ContratacaoData } from '@radar/ingestao';

let lote: ContratacaoData[] = [];
let coletadoEm: string | null = null;

export function salvarLoteDemo(itens: readonly ContratacaoData[]): void {
  lote = [...itens];
  coletadoEm = new Date().toISOString();
}

export function listarLoteDemo(): { itens: ContratacaoData[]; coletadoEm: string | null } {
  return { itens: lote, coletadoEm };
}

export function obterDoLoteDemo(numeroControlePncp: string): ContratacaoData | null {
  return lote.find((c) => c.numeroControlePncp === numeroControlePncp) ?? null;
}

export function resumoLoteParaChat(itens: readonly ContratacaoData[], destaque?: string): string {
  const ordenados = destaque
    ? [
        ...itens.filter((c) => c.numeroControlePncp === destaque),
        ...itens.filter((c) => c.numeroControlePncp !== destaque),
      ]
    : itens;
  return ordenados
    .slice(0, 40)
    .map(
      (c) =>
        `- ${c.numeroControlePncp} | mod=${c.modalidadeCodigo} ${c.modalidadeNome}` +
        `${c.srp ? ' | SRP' : ''} | ${c.orgao.municipio}/${c.orgao.uf}` +
        ` | valor=${c.valorEstimado ?? 'n/d'}` +
        `${c.processo ? ` | processo=${c.processo}` : ''}` +
        `${c.linkSistemaOrigem ? ` | origem=${c.linkSistemaOrigem}` : ''}` +
        ` | ${c.objeto.slice(0, 220)}`,
    )
    .join('\n');
}
