/** @figma nodeId=9:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:215 (Dark) */
import { Badge, Button } from '@/ui/components';
import { useTriagem } from '@/ui/hooks/use-triagem';
import { aderenciaLabel } from '@/domain/triagem-view-model';

interface TriagemPageProps {
  editalId?: string | undefined;
  onBack: () => void;
}

export function TriagemPage({ editalId, onBack }: TriagemPageProps) {
  const triagem = useTriagem({ editalId: editalId ?? '' });

  if (!editalId) {
    return (
      <div style={{ padding: 'var(--radar-space-6)', color: 'var(--radar-color-text-muted)' }}>
        Nenhum edital selecionado.
      </div>
    );
  }

  if (triagem.status === 'loading') {
    return (
      <div style={{ padding: 'var(--radar-space-6)', color: 'var(--radar-color-text-muted)' }}>
        Carregando análise...
      </div>
    );
  }

  if (triagem.status === 'acesso_negado') {
    return (
      <div style={{ padding: 'var(--radar-space-6)', color: 'var(--radar-color-status-reprovado)' }}>
        Acesso negado a este edital.{' '}
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontFamily: 'var(--radar-font-sans)' }}>
          ← Voltar
        </button>
      </div>
    );
  }

  if (triagem.status === 'error') {
    return (
      <div style={{ padding: 'var(--radar-space-6)', color: 'var(--radar-color-status-reprovado)' }}>
        Erro ao carregar triagem: {triagem.message}{' '}
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontFamily: 'var(--radar-font-sans)' }}>
          ← Voltar
        </button>
      </div>
    );
  }

  const { data } = triagem;
  const aderenciaPct = Math.round(data.aderencia * 100);
  const aderenciaColor = data.aderencia >= 0.8
    ? 'var(--radar-color-status-go)'
    : data.aderencia >= 0.5
      ? 'var(--radar-color-status-pendente)'
      : 'var(--radar-color-status-reprovado)';

  return (
    <div style={{ maxWidth: 1120 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', gap: 'var(--radar-space-2)', marginBottom: 'var(--radar-space-6)', color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontFamily: 'var(--radar-font-sans)', fontSize: 'inherit', padding: 0 }}>
          ← Alertas
        </button>
        <span>/</span>
        <span>Triagem</span>
      </div>

      {/* Cabeçalho do edital — dados fixos até GetEditalUseCase existir */}
      <div style={{ background: 'var(--radar-color-bg-surface)', border: '1px solid var(--radar-color-border-default)', borderRadius: 'var(--radar-radius-lg)', padding: 'var(--radar-space-6)', marginBottom: 'var(--radar-space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-3)', marginBottom: 'var(--radar-space-3)' }}>
          <Badge type="info" size="md">Pregão Eletrônico</Badge>
          <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
            PNCP · Nº 001/2026 · Min. da Educação
          </span>
        </div>
        <h1 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4 }}>
          Aquisição de equipamentos de informática para uso administrativo — Pregão Eletrônico nº 001/2026
        </h1>
        <div style={{ display: 'flex', gap: 'var(--radar-space-8)', fontSize: 'var(--radar-font-size-sm)' }}>
          {[
            { label: 'Valor estimado', value: 'R$ 85.000,00' },
            { label: 'Abertura', value: '10/07/2026 às 14h' },
            { label: 'Órgão', value: 'Min. da Educação — FNDE' },
            { label: 'Modo', value: 'Disputa aberta' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--radar-color-text-muted)', fontSize: '0.75rem' }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 'var(--radar-space-6)', alignItems: 'flex-start' }}>
        {/* Análise por IA */}
        <div style={{ flex: 1, background: 'var(--radar-color-bg-surface)', border: '1px solid var(--radar-color-border-default)', borderRadius: 'var(--radar-radius-lg)', padding: 'var(--radar-space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--radar-space-2)', marginBottom: 'var(--radar-space-6)' }}>
            <span style={{ fontSize: '1.25rem' }}>✨</span>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 600 }}>Análise por IA</h2>
              <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
                Confiança: {Math.round(data.confiancaIA * 100)}% · Fonte: edital completo ({data.paginasEdital} págs.)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-4)' }}>
            {data.camposAnalise.map((campo) => (
              <div
                key={campo.titulo}
                style={{
                  background: 'var(--radar-color-bg-canvas)',
                  borderRadius: 'var(--radar-radius-md)',
                  padding: 'var(--radar-space-4)',
                  border: '1px solid var(--radar-color-border-default)',
                }}
              >
                <h3 style={{ margin: '0 0 var(--radar-space-3)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 600 }}>
                  {campo.titulo}
                </h3>
                <p style={{ margin: '0 0 var(--radar-space-3)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-default)', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                  {campo.conteudo}
                </p>
                <div style={{ fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
                  <strong>Fonte:</strong> {campo.fonte}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Painel de decisão go/no-go */}
        <div style={{ width: 320, background: 'var(--radar-color-bg-surface)', border: '1px solid var(--radar-color-border-default)', borderRadius: 'var(--radar-radius-lg)', padding: 'var(--radar-space-6)', flexShrink: 0 }}>
          <h2 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1rem', fontWeight: 600 }}>Decisão go / no-go</h2>

          <div style={{ textAlign: 'center', padding: 'var(--radar-space-6) 0', borderBottom: '1px solid var(--radar-color-border-default)', marginBottom: 'var(--radar-space-4)' }}>
            <div style={{ fontSize: '3rem', fontWeight: 700, color: aderenciaColor, lineHeight: 1 }}>
              {aderenciaPct}%
            </div>
            <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', marginTop: 'var(--radar-space-2)' }}>
              {aderenciaLabel(data.aderencia)} aderência ao seu perfil
            </div>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--radar-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
            {data.checklist.map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 'var(--radar-space-2)', alignItems: 'flex-start', fontSize: 'var(--radar-font-size-sm)' }}>
                <span style={{ color: item.ok ? 'var(--radar-color-status-go)' : 'var(--radar-color-status-pendente)', flexShrink: 0 }}>
                  {item.ok ? '✓' : '⚠'}
                </span>
                <span style={{ color: 'var(--radar-color-text-default)', lineHeight: 1.4 }}>
                  {item.texto}
                </span>
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
            <Button variant="primary" style={{ width: '100%' }}>
              Participar — enviar para Gestão
            </Button>
            <Button variant="secondary" style={{ width: '100%' }}>
              Não participar — arquivar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
