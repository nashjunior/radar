/** @figma nodeId=12:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:308 (Dark) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AcessoNegadoError } from '@radar/kernel';
import { SessaoExpiradaError } from '@/application/errors';
import { Button, Input } from '@/ui/components';
import { useUseCases } from '@/ui/providers/use-cases-provider';
import { useAuth } from '@/ui/providers/auth-provider';
import { useSessao } from '@/ui/hooks/use-sessao';
import { SEGMENTOS_ONBOARDING } from '@/domain/segmentos';
import type { SegmentoId } from '@/domain/segmentos';
import type { FrequenciaNotificacao, CanalNotificacao, DefinirCriterioInput } from '@/application/ports';

const FREQUENCIAS: { key: FrequenciaNotificacao; label: string; descricao: string }[] = [
  { key: 'IMEDIATA', label: 'Tempo real',    descricao: 'Alertado assim que o edital é publicado no PNCP' },
  { key: 'DIARIA',   label: 'Digest diário', descricao: 'Resumo com todos os editais do dia às 08h' },
  { key: 'SEMANAL',  label: 'Digest semanal', descricao: 'Resumo semanal às segundas-feiras' },
];

const CANAIS: { key: CanalNotificacao; icon: string; label: string }[] = [
  { key: 'EMAIL',  icon: '📧', label: 'E-mail' },
  { key: 'IN_APP', icon: '🔔', label: 'In-app' },
];

const cardStyle: React.CSSProperties = {
  background: 'var(--radar-color-bg-surface)',
  border: '1px solid var(--radar-color-border-default)',
  borderRadius: 'var(--radar-radius-lg)',
  padding: 'var(--radar-space-6)',
};

type SalvarEstado =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'sucesso' }
  | { status: 'erro'; mensagem: string };

interface ConfigurarPageProps {
  onOnboarding?: () => void;
}

export function ConfigurarPage({ onOnboarding: _onOnboarding }: ConfigurarPageProps) {
  const { definirCriterio, salvarPreferenciasNotificacao } = useUseCases();
  const { login } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  /* --- segmento (chip preenche palavras-chave sugeridas, editáveis) --- */
  const [segmentoId, setSegmentoId] = useState<SegmentoId | null>(null);

  /* --- critérios (US-04 DefinirCriterioMonitoramento) --- */
  const [palavras, setPalavras] = useState('');
  const [uf, setUf] = useState('');

  /* --- preferências de alerta (US-10 DefinirPreferenciasNotificacao) --- */
  const [frequencia, setFrequencia] = useState<FrequenciaNotificacao>('IMEDIATA');
  const [canais, setCanais] = useState<CanalNotificacao[]>(['EMAIL', 'IN_APP']);

  const [estado, setEstado] = useState<SalvarEstado>({ status: 'idle' });

  const { pode } = useSessao();
  const podeEditarCriterios = pode('CRITERIO_MONITORAMENTO', 'editar');
  const podeEditarPreferencias = pode('PREFERENCIA_NOTIFICACAO', 'editar');

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  function selecionarSegmento(id: SegmentoId) {
    const seg = SEGMENTOS_ONBOARDING.find((s) => s.id === id)!;
    setSegmentoId(id);
    setPalavras(seg.palavras.join(', '));
  }

  function toggleCanal(c: CanalNotificacao) {
    setCanais((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  const handleSalvar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setEstado({ status: 'loading' });

    const criterioInput: DefinirCriterioInput = {};
    const palavrasChave = palavras.split(',').map((p) => p.trim()).filter(Boolean);
    if (uf.trim()) criterioInput.regiaoUf = uf.trim();
    if (palavrasChave.length > 0) criterioInput.palavrasChave = palavrasChave;

    const [criterioResult, prefsResult] = await Promise.allSettled([
      definirCriterio.executar(criterioInput, ctrl.signal),
      salvarPreferenciasNotificacao.executar({ frequencia, canais }, ctrl.signal),
    ]);

    if (ctrl.signal.aborted) return;

    // Sessão expirada em qualquer dos dois → redireciona para login
    const primeiroErro = criterioResult.status === 'rejected'
      ? criterioResult.reason
      : prefsResult.status === 'rejected'
        ? prefsResult.reason
        : null;
    if (primeiroErro instanceof SessaoExpiradaError) {
      void login();
      return;
    }

    const criterioFalhou = criterioResult.status === 'rejected';
    const prefsFalhou = prefsResult.status === 'rejected';

    if (!criterioFalhou && !prefsFalhou) {
      setEstado({ status: 'sucesso' });
      return;
    }

    function descreverErro(err: unknown, contexto: string): string {
      if (err instanceof AcessoNegadoError) return `Acesso negado (${contexto})`;
      return `${contexto} não salvos`;
    }

    const partes = [
      criterioFalhou ? descreverErro(criterioResult.reason, 'critérios') : null,
      prefsFalhou    ? descreverErro(prefsResult.reason,    'preferências') : null,
    ].filter(Boolean).join(' · ');

    setEstado({ status: 'erro', mensagem: `${partes}. Tente novamente.` });
  }, [definirCriterio, salvarPreferenciasNotificacao, palavras, uf, frequencia, canais, login]);

  const salvando = estado.status === 'loading';
  const semPalavras = !palavras.trim();

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
        {podeEditarCriterios && (
          <Button
            variant="primary"
            onClick={() => void handleSalvar()}
            disabled={salvando || semPalavras}
            style={{ flexShrink: 0, marginLeft: 'var(--radar-space-6)' }}
          >
            {salvando ? 'Salvando...' : 'Salvar configurações'}
          </Button>
        )}
      </div>

      {/* Feedback unificado */}
      {estado.status === 'erro' && (
        <div role="alert" style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', fontSize: 'var(--radar-font-size-sm)', borderLeft: '4px solid var(--radar-color-feedback-erro-fg)' }}>
          {estado.mensagem}
        </div>
      )}
      {estado.status === 'sucesso' && (
        <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', fontSize: 'var(--radar-font-size-sm)', borderLeft: '4px solid var(--radar-color-feedback-sucesso-fg)' }}>
          Configurações salvas. O radar usará esses parâmetros nos próximos alertas.
        </div>
      )}

      {/* Duas colunas */}
      <div style={{ display: 'flex', gap: 'var(--radar-space-5)', marginTop: 'var(--radar-space-6)', alignItems: 'flex-start' }}>
        {/* Coluna esquerda — Critérios de busca */}
        <div style={{ ...cardStyle, flex: '1.5' }}>
          <h2 style={{ margin: '0 0 var(--radar-space-5)', fontSize: '1rem', fontWeight: 600 }}>Critérios de busca</h2>

          {/* Segmento de atuação */}
          <div style={{ marginBottom: 'var(--radar-space-5)' }}>
            <p style={{ margin: '0 0 var(--radar-space-3)', fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
              Segmento de atuação
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--radar-space-2)' }}>
              {SEGMENTOS_ONBOARDING.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => podeEditarCriterios && selecionarSegmento(seg.id)}
                  aria-pressed={segmentoId === seg.id}
                  disabled={!podeEditarCriterios}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--radar-space-2)',
                    padding: 'var(--radar-space-2) var(--radar-space-3)',
                    borderRadius: 'var(--radar-radius-full, 999px)',
                    border: `1.5px solid ${segmentoId === seg.id ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)'}`,
                    background: segmentoId === seg.id ? 'var(--radar-color-feedback-info-bg)' : 'transparent',
                    color: segmentoId === seg.id ? 'var(--radar-color-action-primary)' : 'var(--radar-color-text-default)',
                    fontSize: 'var(--radar-font-size-sm)',
                    fontWeight: segmentoId === seg.id ? 600 : 400,
                    cursor: podeEditarCriterios ? 'pointer' : 'default',
                    fontFamily: 'var(--radar-font-sans)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span>{seg.emoji}</span>
                  <span>{seg.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-5)' }}>
            <Input
              label="Palavras-chave"
              placeholder="equipamentos, informática, software, TI"
              value={palavras}
              onChange={(e) => setPalavras(e.target.value)}
              hint="Separe por vírgulas"
              disabled={!podeEditarCriterios}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-2)' }}>
              <Input
                label="UF (opcional)"
                placeholder="Selecione a UF…"
                value={uf}
                onChange={(e) => setUf(e.target.value)}
                disabled={!podeEditarCriterios}
              />
              {podeEditarCriterios && (
                <button
                  type="button"
                  onClick={() => setUf('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: 'var(--radar-font-size-sm)',
                    color: 'var(--radar-color-action-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--radar-font-sans)',
                  }}
                >
                  ○ Sem filtro de UF / Brasil inteiro
                </button>
              )}
            </div>
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
                    cursor: podeEditarPreferencias ? 'pointer' : 'default',
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
                      cursor: podeEditarPreferencias ? 'pointer' : 'default',
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
    </div>
  );
}
