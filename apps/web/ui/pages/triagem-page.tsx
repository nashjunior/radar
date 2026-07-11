/** @figma nodeId=9:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:215 (Dark) */
import { Badge, Button } from '@/ui/components';
import { useTriagem } from '@/ui/hooks/use-triagem';
import { useEdital } from '@/ui/hooks/use-edital';
import { useFeedbackTriagem } from '@/ui/hooks/use-feedback-triagem';
import { useSessao } from '@/ui/hooks/use-sessao';
import { aderenciaLabel } from '@/domain/triagem-view-model';
import { formatarDataColeta } from '@/domain/edital-detalhe';
import type { CampoAnaliseIA, ChecklistItem } from '@/domain/triagem-view-model';

interface TriagemPageProps {
  editalId?: string | undefined;
  onBack: () => void;
}

export function TriagemPage({ editalId, onBack }: TriagemPageProps) {
  const triagem = useTriagem({ editalId: editalId ?? '' });
  const edital = useEdital(editalId ?? '');
  const feedback = useFeedbackTriagem({ editalId: editalId ?? '' });
  const { pode } = useSessao();
  const podeDecidirTriagem = pode('TRIAGEM', 'escrever');

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

  /* Triagem ainda em processamento ou com falha — estados sem dados completos (RAD-79).
     Guardamos pelo positivo para que TypeScript consiga estreitar o tipo no else abaixo. */
  if (data.status !== 'concluida' && data.status !== 'incompleta') {
    const msgs: Record<string, string> = {
      processando: 'Análise em andamento — aguarde alguns instantes e recarregue a página.',
      falha_ocr:   'Não foi possível extrair o texto do edital (OCR falhou). Tente novamente mais tarde.',
      recusada:    'Triagem recusada — edital fora do escopo configurado.',
    };
    return (
      <div style={{ padding: 'var(--radar-space-6)', color: 'var(--radar-color-text-muted)' }}>
        {msgs[data.status] ?? 'Triagem indisponível.'}
        {data.status !== 'processando' && (
          <>
            {' '}
            <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-action-primary)', fontFamily: 'var(--radar-font-sans)' }}>
              ← Voltar
            </button>
          </>
        )}
      </div>
    );
  }

  /* A partir daqui data.status é 'concluida' | 'incompleta' — campos completos disponíveis. */
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

      {/* Cabeçalho do edital — alimentado por GetEditalUseCase (RAD-111) */}
      <div style={{ background: 'var(--radar-color-bg-surface)', border: '1px solid var(--radar-color-border-default)', borderRadius: 'var(--radar-radius-lg)', padding: 'var(--radar-space-6)', marginBottom: 'var(--radar-space-6)' }}>
        {edital.status === 'success' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-3)', marginBottom: 'var(--radar-space-3)' }}>
              <Badge type="info" size="md">{edital.data.modalidade}</Badge>
              <span style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
                Nº {edital.data.numero} · {edital.data.orgao.nome}
              </span>
            </div>
            <h1 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4 }}>
              {edital.data.titulo}
            </h1>
            <div style={{ display: 'flex', gap: 'var(--radar-space-8)', fontSize: 'var(--radar-font-size-sm)', marginBottom: 'var(--radar-space-3)' }}>
              {[
                {
                  label: 'Valor estimado',
                  value: edital.data.valorEstimado !== null
                    ? edital.data.valorEstimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—',
                },
                {
                  label: 'Abertura',
                  value: new Date(edital.data.dataAbertura).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                },
                { label: 'Órgão', value: edital.data.orgao.nome },
                { label: 'Modo', value: edital.data.modoDisputa },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ color: 'var(--radar-color-text-muted)', fontSize: '0.75rem' }}>{label}</span>
                  <span style={{ fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--radar-color-text-disabled, var(--radar-color-text-muted))' }}>
              {edital.data.proveniencia.fonte} · Coletado em {formatarDataColeta(edital.data.proveniencia.dataColeta)} · {edital.data.proveniencia.baseLegal}
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
            {edital.status === 'loading' ? 'Carregando edital...' : 'Edital não encontrado.'}
          </div>
        )}
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
            {data.camposAnalise.map((campo: CampoAnaliseIA) => (
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
            {data.checklist.map((item: ChecklistItem, i: number) => (
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
            {podeDecidirTriagem ? (
              <>
                {feedback.decisaoEstado.status === 'sucesso' ? (
                  <div style={{ textAlign: 'center', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-feedback-sucesso-fg)', padding: 'var(--radar-space-3)', background: 'var(--radar-color-feedback-sucesso-bg)', borderRadius: 'var(--radar-radius-md)' }}>
                    Decisão registrada com sucesso.
                  </div>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      style={{ width: '100%' }}
                      disabled={feedback.decisaoEstado.status === 'loading'}
                      onClick={() => void feedback.registrarDecisao(true)}
                    >
                      {feedback.decisaoEstado.status === 'loading' ? 'Registrando...' : '✓ Participar — enviar para Gestão'}
                    </Button>
                    <Button
                      variant="secondary"
                      style={{ width: '100%' }}
                      disabled={feedback.decisaoEstado.status === 'loading'}
                      onClick={() => void feedback.registrarDecisao(false)}
                    >
                      ✕ Não participar — arquivar
                    </Button>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--radar-color-text-muted)', textAlign: 'center' }}>
                      Sugestão da IA: {data.recomendacao === 'go' ? 'participar' : 'não participar'} · a decisão final é sua
                    </p>
                  </>
                )}
                {feedback.decisaoEstado.status === 'erro' && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--radar-color-feedback-erro-fg)' }}>
                    {feedback.decisaoEstado.mensagem}
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--radar-color-border-default)', paddingTop: 'var(--radar-space-3)', marginTop: 'var(--radar-space-1)' }}>
                  {feedback.contestarEstado.status === 'sucesso' ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>Contestação enviada.</span>
                  ) : (
                    <button
                      onClick={() => void feedback.contestar()}
                      disabled={feedback.contestarEstado.status === 'loading'}
                      style={{ background: 'none', border: 'none', cursor: feedback.contestarEstado.status === 'loading' ? 'wait' : 'pointer', color: 'var(--radar-color-action-primary)', fontSize: '0.75rem', padding: 0, fontFamily: 'var(--radar-font-sans)' }}
                    >
                      {feedback.contestarEstado.status === 'loading' ? 'Enviando...' : 'Esta análise não está correta? Contestar'}
                    </button>
                  )}
                  {feedback.contestarEstado.status === 'erro' && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--radar-color-feedback-erro-fg)', marginTop: 4 }}>
                      {feedback.contestarEstado.mensagem}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                role="status"
                style={{ fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)', textAlign: 'center', padding: 'var(--radar-space-3)' }}
              >
                Visualização em leitura — sem permissão para registrar decisão.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
