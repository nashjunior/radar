/**
 * Página inicial. Vive em `ui/pages` (A12, §2: ui = componentes + páginas).
 * Usa apenas tokens semânticos (dark/light de graça). Quando o Figma da Dora
 * estiver pronto, as telas compõem componentes de `ui/components` (component-first, A12 §6).
 */
export function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        gap: 'var(--radar-space-4)',
        padding: 'var(--radar-space-8)',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Radar de Licitações</h1>
      <p style={{ color: 'var(--radar-color-text-muted)', margin: 0 }}>
        App shell (SPA · Vite, sem Next.js) pronta. Aguardando o Figma da Dora para implementar os componentes.
      </p>
    </main>
  );
}
