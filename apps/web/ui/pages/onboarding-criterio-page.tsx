/** @figma nodeId=258:62 fileKey=SAbjXOQO4gFAH4syq7VdQf (Passo 1) / 259:74 (Passo 2) */
import { useState } from 'react';
import { Button, Input } from '@/ui/components';
import { useDefinirCriterio } from '@/ui/hooks/use-definir-criterio';
import { SEGMENTOS_ONBOARDING } from '@/domain/segmentos';
import type { SegmentoId } from '@/domain/segmentos';

export { SEGMENTOS_ONBOARDING } from '@/domain/segmentos';

interface OnboardingCriterioPageProps {
  onConcluido: () => void;
}

function StepDots({ passo }: { passo: 1 | 2 }) {
  const dotBase: React.CSSProperties = {
    borderRadius: 3,
    height: 6,
    flexShrink: 0,
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{
        ...dotBase,
        width: passo === 1 ? 24 : 6,
        background: passo === 1 ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)',
        opacity: passo === 1 ? 1 : 0.4,
      }} />
      <div style={{
        ...dotBase,
        width: passo === 2 ? 24 : 6,
        background: passo === 2 ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)',
      }} />
    </div>
  );
}

interface SegmentoCardProps {
  emoji: string;
  nome: string;
  palavras: readonly [string, string];
  selecionado: boolean;
  onClick: () => void;
}

function SegmentoCard({ emoji, nome, palavras, selecionado, onClick }: SegmentoCardProps) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 186,
        padding: 20,
        borderRadius: 10,
        border: `1.5px solid ${selecionado ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)'}`,
        background: selecionado ? 'var(--radar-color-feedback-info-bg)' : 'var(--radar-color-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-start',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, background 0.15s',
        fontFamily: 'var(--radar-font-sans)',
        boxSizing: 'border-box',
      }}
      aria-pressed={selecionado}
    >
      <span style={{ fontSize: 24 }}>{emoji}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--radar-color-text-default)', lineHeight: 1.4 }}>
        {nome}
      </span>
      <span style={{ fontSize: 12, color: 'var(--radar-color-text-muted)', lineHeight: 1.4 }}>
        {`Palavras-chave: "${palavras[0]}", "${palavras[1]}"`}
      </span>
    </button>
  );
}

export function OnboardingCriterioPage({ onConcluido }: OnboardingCriterioPageProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [segmentoId, setSegmentoId] = useState<SegmentoId | null>(null);
  const [palavrasChave, setPalavrasChave] = useState('');
  const [uf, setUf] = useState('');

  const { estado, salvar } = useDefinirCriterio();

  const segmentoSelecionado = segmentoId
    ? SEGMENTOS_ONBOARDING.find((s) => s.id === segmentoId) ?? null
    : null;

  function selecionarSegmento(id: SegmentoId) {
    const seg = SEGMENTOS_ONBOARDING.find((s) => s.id === id)!;
    setSegmentoId(id);
    setPalavrasChave(seg.palavras.join(', '));
  }

  function avancar() {
    if (!segmentoSelecionado) return;
    setPasso(2);
  }

  function voltar() {
    setPasso(1);
  }

  async function criarRadar() {
    const kws = palavrasChave.split(',').map((p) => p.trim()).filter(Boolean);
    const input: { palavrasChave?: string[]; regiaoUf?: string } = {};
    if (kws.length > 0) input.palavrasChave = kws;
    if (uf.trim()) input.regiaoUf = uf.trim();

    await salvar(input);
    onConcluido();
  }

  const salvando = estado.status === 'loading';

  const contentStyle: React.CSSProperties = {
    paddingTop: 48,
    paddingLeft: 40,
    paddingRight: 40,
    display: 'flex',
    flexDirection: 'column',
    gap: passo === 1 ? 32 : 28,
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={contentStyle}>
      <StepDots passo={passo} />

      {passo === 1 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: 'var(--radar-color-text-default)' }}>
              Qual é o segmento da sua empresa?
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--radar-color-text-muted)', lineHeight: 1.5, maxWidth: 620 }}>
              Escolha o segmento mais próximo da sua atuação. Vamos sugerir duas palavras-chave de busca para você.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Linha 1 */}
            <div style={{ display: 'flex', gap: 16 }}>
              {SEGMENTOS_ONBOARDING.slice(0, 3).map((seg) => (
                <SegmentoCard
                  key={seg.id}
                  emoji={seg.emoji}
                  nome={seg.nome}
                  palavras={seg.palavras}
                  selecionado={segmentoId === seg.id}
                  onClick={() => selecionarSegmento(seg.id)}
                />
              ))}
            </div>
            {/* Linha 2 */}
            <div style={{ display: 'flex', gap: 16 }}>
              {SEGMENTOS_ONBOARDING.slice(3).map((seg) => (
                <SegmentoCard
                  key={seg.id}
                  emoji={seg.emoji}
                  nome={seg.nome}
                  palavras={seg.palavras}
                  selecionado={segmentoId === seg.id}
                  onClick={() => selecionarSegmento(seg.id)}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="primary"
              onClick={avancar}
              disabled={!segmentoSelecionado}
            >
              Avançar →
            </Button>
          </div>
        </>
      )}

      {passo === 2 && segmentoSelecionado && (
        <>
          {/* Badge do segmento selecionado */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 20,
            border: '1px solid var(--radar-color-action-primary)',
            background: 'var(--radar-color-bg-surface)',
            width: 'fit-content',
          }}>
            <span style={{ fontSize: 14 }}>{segmentoSelecionado.emoji}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--radar-color-action-primary)' }}>
              {segmentoSelecionado.nome}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--radar-color-text-default)' }}>
              Confirme seu primeiro critério
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--radar-color-text-muted)', lineHeight: 1.5, maxWidth: 480 }}>
              Ajuste as configurações abaixo. Você pode editá-las a qualquer momento.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ maxWidth: 440 }}>
              <Input
                label="Palavras-chave"
                value={palavrasChave}
                onChange={(e) => setPalavrasChave(e.target.value)}
                hint="Separe por vírgulas"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ maxWidth: 440 }}>
                <Input
                  label="UF (opcional)"
                  placeholder="Selecione a UF..."
                  value={uf}
                  onChange={(e) => setUf(e.target.value)}
                />
              </div>
              <button
                onClick={() => setUf('')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 13,
                  color: 'var(--radar-color-action-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--radar-font-sans)',
                }}
              >
                ○ Sem filtro de UF / Brasil inteiro
              </button>
            </div>
          </div>

          {estado.status === 'erro' && (
            <div style={{
              padding: 'var(--radar-space-3) var(--radar-space-4)',
              borderRadius: 'var(--radar-radius-sm)',
              background: 'var(--radar-color-feedback-erro-bg)',
              color: 'var(--radar-color-feedback-erro-fg)',
              fontSize: 'var(--radar-font-size-sm)',
              borderLeft: '4px solid var(--radar-color-feedback-erro-fg)',
            }}>
              {estado.mensagem}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
            <button
              onClick={voltar}
              disabled={salvando}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 13,
                color: 'var(--radar-color-text-muted)',
                cursor: 'pointer',
                fontFamily: 'var(--radar-font-sans)',
              }}
            >
              ← Voltar
            </button>
            <Button
              variant="primary"
              onClick={() => void criarRadar()}
              disabled={salvando || palavrasChave.trim() === ''}
            >
              {salvando ? 'Criando...' : 'Criar meu radar'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
