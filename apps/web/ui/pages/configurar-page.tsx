/** @figma nodeId=12:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:308 (Dark) */
import { useState } from 'react';
import { Button, Input } from '@/ui/components';

type Frequencia = 'tempo-real' | 'diario' | 'semanal';
type Canal = 'email' | 'in-app' | 'whatsapp';

const REGIOES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export function ConfigurarPage() {
  const [cnaes, setCnaes] = useState<string[]>(['4751-2/01', '6201-5/01']);
  const [regioesSel, setRegioesSel] = useState<string[]>(['DF']);
  const [valorMin, setValorMin] = useState('');
  const [valorMax, setValorMax] = useState('');
  const [palavras, setPalavras] = useState('software, TI, informática');
  const [frequencia, setFrequencia] = useState<Frequencia>('diario');
  const [canais, setCanais] = useState<Canal[]>(['email', 'in-app']);
  const [saved, setSaved] = useState(false);

  function toggleRegiao(uf: string) {
    setRegioesSel((prev) => prev.includes(uf) ? prev.filter((r) => r !== uf) : [...prev, uf]);
  }

  function toggleCanal(c: Canal) {
    setCanais((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-8)', fontSize: '1.25rem', fontWeight: 600 }}>Configurar Radar</h1>

      <section style={{ marginBottom: 'var(--radar-space-8)' }}>
        <h2 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1rem', fontWeight: 600 }}>Critérios de busca</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-6)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>
              CNAE
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--radar-space-2)' }}>
              {cnaes.map((c) => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--radar-space-1)', background: 'var(--radar-color-bg-subtle)', borderRadius: 'var(--radar-radius-sm)', padding: '4px 10px', fontSize: 'var(--radar-font-size-sm)', border: '1px solid var(--radar-color-border-default)' }}>
                  {c}
                  <button onClick={() => setCnaes((prev) => prev.filter((x) => x !== c))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--radar-color-text-muted)', padding: 0, fontSize: '0.85rem' }}>✕</button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>
              Região (UF / município)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--radar-space-1)' }}>
              {REGIOES.map((uf) => (
                <button
                  key={uf}
                  onClick={() => toggleRegiao(uf)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radar-radius-sm)',
                    border: `1px solid ${regioesSel.includes(uf) ? 'var(--radar-color-action-primary)' : 'var(--radar-color-border-default)'}`,
                    background: regioesSel.includes(uf) ? 'var(--radar-color-action-primary)' : 'transparent',
                    color: regioesSel.includes(uf) ? 'var(--radar-color-text-onPrimary)' : 'var(--radar-color-text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--radar-font-sans)',
                    transition: 'all 0.15s',
                  }}
                >
                  {uf}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--radar-space-4)' }}>
            <Input label="Valor mínimo (R$)" placeholder="0,00" value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
            <Input label="Valor máximo (R$)" placeholder="Sem limite" value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
          </div>

          <Input
            label="Palavras-chave"
            placeholder="software, TI, informática..."
            value={palavras}
            onChange={(e) => setPalavras(e.target.value)}
            hint="Separe por vírgulas"
          />
        </div>
      </section>

      <section style={{ marginBottom: 'var(--radar-space-8)' }}>
        <h2 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1rem', fontWeight: 600 }}>Preferências de alerta</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-6)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>Frequência</label>
            <div style={{ display: 'flex', gap: 'var(--radar-space-4)' }}>
              {(['tempo-real', 'diario', 'semanal'] as Frequencia[]).map((f) => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-2)', cursor: 'pointer', fontSize: 'var(--radar-font-size-sm)' }}>
                  <input type="radio" checked={frequencia === f} onChange={() => setFrequencia(f)} style={{ accentColor: 'var(--radar-color-action-primary)' }} />
                  {{ 'tempo-real': 'Tempo real', diario: 'Digest diário', semanal: 'Semanal' }[f]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>Canais</label>
            <div style={{ display: 'flex', gap: 'var(--radar-space-4)' }}>
              {(['email', 'in-app', 'whatsapp'] as Canal[]).map((c) => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-2)', cursor: 'pointer', fontSize: 'var(--radar-font-size-sm)' }}>
                  <input type="checkbox" checked={canais.includes(c)} onChange={() => toggleCanal(c)} style={{ accentColor: 'var(--radar-color-action-primary)' }} />
                  {{ email: 'E-mail', 'in-app': 'In-app', whatsapp: 'WhatsApp' }[c]}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Button variant="primary" onClick={handleSave}>
        {saved ? '✓ Salvo!' : 'Salvar configurações'}
      </Button>
    </div>
  );
}
