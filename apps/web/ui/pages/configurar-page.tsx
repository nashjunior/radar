/** @figma nodeId=12:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 15:308 (Dark) */
import { useState } from 'react';
import { Button, Input } from '@/ui/components';
import { useDefinirCriterio } from '@/ui/hooks/use-definir-criterio';
import { authGateway } from '@/infra/container';

type Frequencia = 'tempo-real' | 'diario' | 'semanal';
type Canal = 'email' | 'in-app' | 'whatsapp';

/** Códigos da tabela faixa_valor_referencia (Lei 14.133/2021 arts. 75-76). */
const FAIXAS_VALOR = [
  { codigo: '', label: 'Qualquer valor' },
  { codigo: 'MICRO_COMPRA',       label: 'Micro compra — até R$ 100 mil' },
  { codigo: 'DISPENSA_SERVICOS',  label: 'Dispensa serviços — até R$ 50 mil' },
  { codigo: 'DISPENSA_OBRAS',     label: 'Dispensa obras — R$ 100 mil a R$ 500 mil' },
  { codigo: 'CONVITE',            label: 'Convite — R$ 50 mil a R$ 250 mil' },
  { codigo: 'TOMADA_PRECOS_SERV', label: 'Tomada de preços serviços — R$ 250 mil a R$ 1,43 mi' },
  { codigo: 'TOMADA_PRECOS_OBRAS',label: 'Tomada de preços obras — R$ 500 mil a R$ 3,3 mi' },
  { codigo: 'CONCORRENCIA_SERV',  label: 'Concorrência serviços — acima de R$ 1,43 mi' },
  { codigo: 'CONCORRENCIA_OBRAS', label: 'Concorrência obras — acima de R$ 3,3 mi' },
] as const;

const UFS = ['', 'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const FREQ_API: Record<Frequencia, string> = {
  'tempo-real': 'IMEDIATA',
  diario: 'DIARIA',
  semanal: 'SEMANAL',
};

/** Domínio Notificação: EMAIL | IN_APP | WEBHOOK (WhatsApp → WEBHOOK na demo). */
function canaisParaApi(canais: Canal[]): string[] {
  const out: string[] = [];
  if (canais.includes('email')) out.push('EMAIL');
  if (canais.includes('in-app')) out.push('IN_APP');
  if (canais.includes('whatsapp')) out.push('WEBHOOK');
  return out.length > 0 ? out : ['IN_APP'];
}

const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--radar-radius-sm)',
  border: '1px solid var(--radar-color-border-default)',
  background: 'var(--radar-color-bg-canvas)',
  color: 'var(--radar-color-text-default)',
  fontSize: 'var(--radar-font-size-sm)',
  fontFamily: 'var(--radar-font-sans)',
  outline: 'none',
};

export function ConfigurarPage() {
  /* --- critérios (US-04 DefinirCriterioMonitoramento) --- */
  const [cnae, setCnae] = useState('6201-5/01');
  const [uf, setUf] = useState('DF');
  const [faixaCodigo, setFaixaCodigo] = useState('');
  const [palavras, setPalavras] = useState('software, TI, informática');
  const { estado, salvar } = useDefinirCriterio();

  /* --- preferências de alerta (memória no BFF) --- */
  const [frequencia, setFrequencia] = useState<Frequencia>('diario');
  const [canais, setCanais] = useState<Canal[]>(['email', 'in-app']);
  const [prefEstado, setPrefEstado] = useState<
    'idle' | 'salvando' | 'sucesso' | 'erro'
  >('idle');
  const [prefMsg, setPrefMsg] = useState('');

  function toggleCanal(c: Canal) {
    setCanais((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  }

  function handleSalvarCriterio() {
    const palavrasChave = palavras
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const input: Parameters<typeof salvar>[0] = {};
    if (cnae.trim()) input.ramoCnae = cnae.trim();
    if (uf) input.regiaoUf = uf;
    if (faixaCodigo) input.faixaValorCodigo = faixaCodigo;
    if (palavrasChave.length > 0) input.palavrasChave = palavrasChave;

    void salvar(input);
  }

  async function handleSalvarPreferencias() {
    setPrefEstado('salvando');
    setPrefMsg('');
    try {
      const token = await authGateway.obterToken();
      const res = await fetch(`${apiBase}/api/notificacao/preferencias`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          canais: canaisParaApi(canais),
          frequencia: FREQ_API[frequencia],
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { mensagem?: string } | null;
        throw new Error(err?.mensagem ?? `HTTP ${res.status}`);
      }
      setPrefEstado('sucesso');
      setPrefMsg('Preferências salvas (em memória no BFF). Digest/e-mail ficam para o módulo de Notificação.');
    } catch (e) {
      setPrefEstado('erro');
      setPrefMsg(e instanceof Error ? e.message : 'Falha ao salvar preferências.');
    }
  }

  const salvando = estado.status === 'loading';

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-8)', fontSize: '1.25rem', fontWeight: 600 }}>Configurar Radar</h1>

      {/* Critérios de busca — US-04 */}
      <section style={{ marginBottom: 'var(--radar-space-8)' }}>
        <h2 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1rem', fontWeight: 600 }}>Critérios de busca</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-6)' }}>
          <Input
            label="CNAE principal"
            placeholder="Ex.: 6201-5/01"
            value={cnae}
            onChange={(e) => setCnae(e.target.value)}
            hint="Código CNAE da atividade principal da empresa"
          />

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>
              Região (UF)
            </label>
            <select value={uf} onChange={(e) => setUf(e.target.value)} style={selectStyle}>
              <option value="">Qualquer UF</option>
              {UFS.slice(1).map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>
              Faixa de valor (Lei 14.133/2021)
            </label>
            <select value={faixaCodigo} onChange={(e) => setFaixaCodigo(e.target.value)} style={selectStyle}>
              {FAIXAS_VALOR.map(({ codigo, label }) => (
                <option key={codigo} value={codigo}>{label}</option>
              ))}
            </select>
          </div>

          <Input
            label="Palavras-chave"
            placeholder="software, TI, informática..."
            value={palavras}
            onChange={(e) => setPalavras(e.target.value)}
            hint="Separe por vírgulas"
          />
        </div>

        {/* Feedback do critério salvo */}
        {estado.status === 'erro' && (
          <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', fontSize: 'var(--radar-font-size-sm)' }}>
            {estado.mensagem}
          </div>
        )}
        {estado.status === 'sucesso' && (
          <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', fontSize: 'var(--radar-font-size-sm)' }}>
            Critério salvo
            {typeof estado.criterio.alertasGerados === 'number'
              ? `: ${estado.criterio.alertasGerados} edital(is) do lote PNCP casaram — veja o Dashboard / Alertas.`
              : '. O radar usará esses parâmetros nos próximos alertas.'}
            {estado.criterio.alertasGerados === 0
              ? ' Nenhum match ainda: atualize o lote em Oportunidades (Atualizar PNCP) ou amplie palavras-chave/UF.'
              : ''}
          </div>
        )}

        <div style={{ marginTop: 'var(--radar-space-6)' }}>
          <Button variant="primary" onClick={handleSalvarCriterio} disabled={salvando}>
            {salvando ? 'Salvando e casando…' : 'Salvar critério e gerar alertas'}
          </Button>
        </div>
      </section>

      {/* Preferências — memória no BFF */}
      <section style={{ marginBottom: 'var(--radar-space-8)' }}>
        <h2 style={{ margin: '0 0 var(--radar-space-1)', fontSize: '1rem', fontWeight: 600 }}>Preferências de alerta</h2>
        <p style={{ margin: '0 0 var(--radar-space-4)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
          Alertas in-app já aparecem no Dashboard. Frequência/canais ficam gravados em memória para o digest futuro.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-6)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>Frequência</label>
            <div style={{ display: 'flex', gap: 'var(--radar-space-4)' }}>
              {(['tempo-real', 'diario', 'semanal'] as Frequencia[]).map((f) => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 'var(--radar-space-2)', cursor: 'pointer', fontSize: 'var(--radar-font-size-sm)' }}>
                  <input
                    type="radio"
                    checked={frequencia === f}
                    onChange={() => setFrequencia(f)}
                    style={{ accentColor: 'var(--radar-color-action-primary)' }}
                  />
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
                  <input
                    type="checkbox"
                    checked={canais.includes(c)}
                    onChange={() => toggleCanal(c)}
                    style={{ accentColor: 'var(--radar-color-action-primary)' }}
                  />
                  {{ email: 'E-mail', 'in-app': 'In-app', whatsapp: 'WhatsApp' }[c]}
                </label>
              ))}
            </div>
          </div>
        </div>

        {prefEstado === 'erro' && (
          <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-erro-bg)', color: 'var(--radar-color-feedback-erro-fg)', fontSize: 'var(--radar-font-size-sm)' }}>
            {prefMsg}
          </div>
        )}
        {prefEstado === 'sucesso' && (
          <div style={{ marginTop: 'var(--radar-space-4)', padding: 'var(--radar-space-3) var(--radar-space-4)', borderRadius: 'var(--radar-radius-sm)', background: 'var(--radar-color-feedback-sucesso-bg)', color: 'var(--radar-color-feedback-sucesso-fg)', fontSize: 'var(--radar-font-size-sm)' }}>
            {prefMsg}
          </div>
        )}

        <div style={{ marginTop: 'var(--radar-space-6)' }}>
          <Button variant="secondary" onClick={() => void handleSalvarPreferencias()} disabled={prefEstado === 'salvando'}>
            {prefEstado === 'salvando' ? 'Salvando…' : 'Salvar preferências'}
          </Button>
        </div>
      </section>
    </div>
  );
}
