/** @figma nodeId=12:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:308 (Dark) */
import { useState } from 'react';
import { Button, Input } from '@/ui/components';
import { useDefinirCriterio } from '@/ui/hooks/use-definir-criterio';
import { useSessao } from '@/ui/hooks/use-sessao';

type Frequencia = 'tempo-real' | 'diario' | 'semanal';
type Canal = 'email' | 'in-app' | 'whatsapp';

const FREQUENCIAS: { key: Frequencia; label: string; descricao: string }[] = [
  { key: 'tempo-real', label: 'Tempo real',    descricao: 'Alertado assim que o edital é publicado no PNCP' },
  { key: 'diario',     label: 'Digest diário', descricao: 'Resumo com todos os editais do dia às 08h' },
  { key: 'semanal',    label: 'Digest semanal', descricao: 'Resumo semanal às segundas-feiras' },
];

const CANAIS: { key: Canal; icon: string; label: string }[] = [
  { key: 'email',    icon: '✉️', label: 'E-mail' },
  { key: 'in-app',  icon: '🔔', label: 'In-app' },
  { key: 'whatsapp', icon: '💬', label: 'WhatsApp' },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--radar-color-bg-surface)',
  border: '1px solid var(--radar-color-border-default)',
  borderRadius: 'var(--radar-radius-lg)',
  padding: 'var(--radar-space-6)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 'var(--radar-space-2)',
  fontSize: 'var(--radar-font-size-sm)',
  fontWeight: 500,
  color: 'var(--radar-color-text-default)',
};

interface ConfigurarPageProps {
  onOnboarding?: () => void;
}

export function ConfigurarPage({ onOnboarding }: ConfigurarPageProps) {
  /* --- critérios (US-04 DefinirCriterioMonitoramento) --- */
  /* Defaults vêm do GET /api/matching/criterios (RAD-311). Por ora iniciam vazios. */
  const [regiao, setRegiao] = useState('');
  const [palavras, setPalavras] = useState('');
  const { estado, salvar } = useDefinirCriterio();

  /* --- preferências de alerta (aguarda E4/RAD-64) --- */
  const [frequencia, setFrequencia] = useState<Frequencia>('tempo-real');
  const [canais, setCanais] = useState<Canal[]>(['email', 'in-app']);

  const { pode } = useSessao();
  const podeEditarCriterios = pode('CRITERIO_MONITORAMENTO', 'editar');
  const podeEditarPreferencias = pode('PREFERENCIA_NOTIFICACAO', 'editar');

  function toggleCanal(c: Canal) {
    setCanais((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  function handleSalvar() {
    const palavrasChave = palavras
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const input: Parameters<typeof salvar>[0] = {};
    if (regiao.trim()) input.regiaoUf = regiao.trim();
    if (palavrasChave.length > 0) input.palavrasChave = palavrasChave;

    void salvar(input);
  }

  const salvando = estado.status === 'loading';
  const semCriterio = !palavras.trim() && !regiao.trim();

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--radar-space-2)' }}>
        <div>
          <h1 style={{ margin: '0 0 var(--radar-space-2)', fontSize: '1.25rem', fontWeight: 600 }}>Configurar Radar</h1>
          <p style={{ margin: 0, fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
            Defina os critérios que determinam quais editais do PNCP serão monitorados e quando você será notificado.
          </p>
        </div>
        {podeEditarCriterios && !semCriterio && (
          <Button
            variant="primary"
            onClick={handleSalvar}
            disabled={salvando}
            style={{ flexShrink: 0, marginLeft: 'var(--radar-space-6)' }}
          >
            {salvando ? 'Salvando...' : 'Salvar configurações'}
          </Button>
        )}
      </div>

      {/* Feedback */}
      {estado.status === 'erro' && (
        <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', fontSize: 'var(--radar-font-size-sm)', borderLeft: '4px solid var(--radar-color-feedback-erro-fg)' }}>
          {estado.mensagem}
        </div>
      )}
      {estado.status === 'sucesso' && (
        <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', fontSize: 'var(--radar-font-size-sm)', borderLeft: '4px solid var(--radar-color-feedback-sucesso-fg)' }}>
          Configurações salvas. O radar usará esses parâmetros nos próximos alertas.
        </div>
      )}

      {/* Estado vazio — sem critério configurado */}
      {semCriterio && podeEditarCriterios && (
        <div style={{ marginTop: 'var(--radar-space-6)', ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--radar-space-4)', padding: 'var(--radar-space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: '2rem', margin: 0 }}>⚙️</p>
          <div>
            <p style={{ margin: '0 0 var(--radar-space-2)', fontSize: '1rem', fontWeight: 600, color: 'var(--radar-color-text-default)' }}>
              Seu radar ainda não está configurado
            </p>
            <p style={{ margin: 0, fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)', maxWidth: 400 }}>
              Configure as palavras-chave e a região para que o sistema identifique os editais certos para você.
            </p>
          </div>
          {onOnboarding && (
            <Button variant="primary" onClick={onOnboarding}>
              Configurar meu radar
            </Button>
          )}
        </div>
      )}

      {/* Dois colunas — só mostra quando há critério ou usuário está editando */}
      {(!semCriterio || !podeEditarCriterios) && (
        <div style={{ display: 'flex', gap: 'var(--radar-space-5)', marginTop: 'var(--radar-space-6)', alignItems: 'flex-start' }}>
          {/* Coluna esquerda — Critérios de busca */}
          <div style={{ ...cardStyle, flex: '1.5' }}>
            <h2 style={{ margin: '0 0 var(--radar-space-5)', fontSize: '1rem', fontWeight: 600 }}>Critérios de busca</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-5)' }}>
              <Input
                label="Região (UF ou Município)"
                placeholder="Ex.: Brasília, DF + Nacional"
                value={regiao}
                onChange={(e) => setRegiao(e.target.value)}
                disabled={!podeEditarCriterios}
              />

              <Input
                label="Palavras-chave (opcional)"
                placeholder="equipamentos, informática, software, TI"
                value={palavras}
                onChange={(e) => setPalavras(e.target.value)}
                hint="Separe por vírgulas"
                disabled={!podeEditarCriterios}
              />
            </div>
          </div>

          {/* Coluna direita — Preferências de alerta */}
          <div style={{ ...cardStyle, flex: 1 }}>
            <h2 style={{ margin: '0 0 var(--radar-space-5)', fontSize: '1rem', fontWeight: 600 }}>Preferências de alerta</h2>

            <div style={{ marginBottom: 'var(--radar-space-5)' }}>
              <p style={{ margin: '0 0 var(--radar-space-3)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
                Frequência de notificação
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-2)' }}>
                {FREQUENCIAS.map(({ key, label, descricao }) => (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      gap: 'var(--radar-space-3)',
                      padding: 'var(--radar-space-3) var(--radar-space-4)',
                      borderRadius: 'var(--radar-radius-md)',
                      border: `1px solid ${frequencia === key ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)'}`,
                      cursor: 'pointer',
                      background: frequencia === key ? 'var(--radar-color-feedback-info-bg)' : 'transparent',
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <input
                      type="radio"
                      name="frequencia"
                      checked={frequencia === key}
                      onChange={() => podeEditarPreferencias && setFrequencia(key)}
                      disabled={!podeEditarPreferencias}
                      style={{ accentColor: 'var(--radar-color-action-primary)', flexShrink: 0, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 'var(--radar-font-size-sm)', fontWeight: frequencia === key ? 600 : 400, color: frequencia === key ? 'var(--radar-color-action-primary)' : 'var(--radar-color-text-default)' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--radar-color-text-muted)', marginTop: 2 }}>
                        {descricao}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p style={{ margin: '0 0 var(--radar-space-3)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
                Canal de notificação
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-3)' }}>
                {CANAIS.map(({ key, icon, label }) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)' }}>
                      <span>{icon}</span>
                      <span>{label}</span>
                    </div>
                    <button
                      role="switch"
                      aria-checked={canais.includes(key)}
                      onClick={() => podeEditarPreferencias && toggleCanal(key)}
                      disabled={!podeEditarPreferencias}
                      aria-label={`${label} ${canais.includes(key) ? 'ativo' : 'inativo'}`}
                      style={{
                        width: 44,
                        height: 24,
                        borderRadius: 12,
                        border: 'none',
                        cursor: 'pointer',
                        background: canais.includes(key) ? 'var(--radar-color-action-primary)' : 'var(--radar-color-bg-overlay)',
                        position: 'relative',
                        transition: 'background 0.2s',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute',
                        top: 2,
                        left: canais.includes(key) ? 22 : 2,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'white',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'left 0.2s',
                        display: 'block',
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
