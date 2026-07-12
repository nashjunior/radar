/* docs/11 §3.2 — tabela canônica de segmentos; 2 palavras por segmento é regra de domínio (P-81). */
export const SEGMENTOS_ONBOARDING = [
  { id: 'ti-software',    emoji: '💻', nome: 'TI e software',                 palavras: ['software', 'sistema'] as [string, string] },
  { id: 'obras',          emoji: '🏗️', nome: 'Obras e manutenção predial',    palavras: ['obra', 'reforma'] as [string, string] },
  { id: 'saude',          emoji: '💊', nome: 'Saúde e insumos hospitalares',  palavras: ['medicamento', 'hospitalar'] as [string, string] },
  { id: 'informatica',    emoji: '🖥️', nome: 'Equipamentos de informática',   palavras: ['computador', 'notebook'] as [string, string] },
  { id: 'limpeza',        emoji: '🧹', nome: 'Limpeza e conservação',         palavras: ['limpeza', 'conservação'] as [string, string] },
  { id: 'seguranca',      emoji: '🛡️', nome: 'Segurança e vigilância',        palavras: ['vigilância', 'segurança'] as [string, string] },
] as const;

export type SegmentoId = (typeof SEGMENTOS_ONBOARDING)[number]['id'];
