/**
 * Converte resposta de LLM com markdown residual em texto plano legível no chat.
 * O painel não renderiza markdown — asteriscos/hashes estouram o layout.
 */

export function paraTextoPlano(bruto: string): string {
  let t = bruto.replace(/\r\n/g, '\n').trim();

  // Blocos e spans de código
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');

  // Títulos
  t = t.replace(/^#{1,6}\s+/gm, '');

  // Negrito / itálico (ordem: *** depois ** depois *)
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/_([^_\n]+)_/g, '$1');

  // Links [texto](url) → texto (url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Listas markdown → bullet simples
  t = t.replace(/^\s*[-*+]\s+/gm, '• ');

  // Citações e regras
  t = t.replace(/^>\s?/gm, '');
  t = t.replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // Sobras de ênfase soltas
  t = t.replace(/(^|\s)[*_]{1,3}(?=\s|$)/gm, '$1');

  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
