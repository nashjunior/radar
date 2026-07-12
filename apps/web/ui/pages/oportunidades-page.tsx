/** @figma — tela demo local: lista PNCP + detalhe + chat */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Input } from '@/ui/components';
import { DemoPncpHttpGateway, ehErroRedeTransitorio, mensagemErroRede } from '@/infra/api/demo-pncp-http-gateway';
import type { DemoEditalCard, DemoEditalDetalhe } from '@/infra/api/demo-pncp-http-gateway';
import { authGateway } from '@/infra/container';

const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
const gateway = new DemoPncpHttpGateway(apiBase, () => authGateway.obterToken());

const ATALHOS_BUSCA = [
  { label: 'Construção / obras', q: 'obra construção reforma pavimentação engenharia' },
  { label: 'TI / software', q: 'tecnologia software informática sistema' },
  { label: 'Limpar filtro', q: '' },
] as const;

async function comRetry<T>(fn: () => Promise<T>, tentativas = 3, esperaMs = 800): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (!ehErroRedeTransitorio(err) || i === tentativas - 1) throw err;
      await new Promise((r) => setTimeout(r, esperaMs * (i + 1)));
    }
  }
  throw ultimo;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

function formatValor(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OportunidadesPage() {
  const [editais, setEditais] = useState<DemoEditalCard[]>([]);
  const [coletadoEm, setColetadoEm] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DemoEditalDetalhe | null>(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  const [chat, setChat] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text: 'Olá! Posso ajudar a explorar os editais desta lista. Pergunte, por exemplo: “quais são de SP?” ou “resuma o edital selecionado”.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async (refresh = false, buscaOverride?: string) => {
    const termo = buscaOverride !== undefined ? buscaOverride : busca;
    setLoading(true);
    try {
      const res = await comRetry(() =>
        gateway.listar({
          ...(termo.trim() ? { q: termo.trim() } : {}),
          refresh,
          signal: AbortSignal.timeout(60_000),
        }),
      );
      setEditais(res.editais);
      setColetadoEm(res.coletadoEm);
      setErroLista(null);
      if (res.editais[0]) {
        setSelecionado((atual) => atual ?? res.editais[0]!.numeroControlePncp);
      }
    } catch (err) {
      // Lista já na tela: falha transitória fica invisível (retry já tentou).
      setEditais((atuais) => {
        if (atuais.length === 0) setErroLista(mensagemErroRede(err));
        return atuais;
      });
    } finally {
      setLoading(false);
    }
  }, [busca]);

  useEffect(() => {
    void carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial
  }, []);

  useEffect(() => {
    if (!selecionado) {
      setDetalhe(null);
      return;
    }
    const ac = new AbortController();
    setLoadingDetalhe(true);
    void gateway
      .detalhe(selecionado, ac.signal)
      .then(setDetalhe)
      .catch(() => setDetalhe(null))
      .finally(() => setLoadingDetalhe(false));
    return () => ac.abort();
  }, [selecionado]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  async function enviarChat() {
    const msg = draft.trim();
    if (!msg || chatBusy) return;
    setDraft('');
    setChat((prev) => [...prev, { role: 'user', text: msg }]);
    setChatBusy(true);
    try {
      const resposta = await comRetry(
        () =>
          gateway.chat(msg, {
            ...(selecionado ? { numeroControlePncp: selecionado } : {}),
            signal: AbortSignal.timeout(120_000),
          }),
        2,
        1500,
      );
      setChat((prev) => [...prev, { role: 'assistant', text: resposta }]);
    } catch (err) {
      const texto = ehErroRedeTransitorio(err)
        ? 'Aguarde um instante e envie de novo — ainda estou conectando.'
        : mensagemErroRede(err);
      setChat((prev) => [...prev, { role: 'assistant', text: texto }]);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--radar-space-4)', height: 'calc(100dvh - 64px)', maxWidth: 1400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Oportunidades (PNCP)</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
            Lista ao vivo da API pública · detalhe ao lado · chat para explorar
            {coletadoEm ? ` · coletado ${formatData(coletadoEm)}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            placeholder="Filtrar objeto, órgão, UF…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void carregar(false)}
          />
          <Button onClick={() => void carregar(false)}>Filtrar</Button>
          <Button onClick={() => void carregar(true)}>Atualizar PNCP</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ATALHOS_BUSCA.map((a) => (
          <Button
            key={a.label}
            variant="secondary"
            size="sm"
            onClick={() => {
              setBusca(a.q);
              void carregar(true, a.q);
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {erroLista && editais.length === 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--radar-color-bg-canvas)',
            color: 'var(--radar-color-text-muted)',
            borderRadius: 'var(--radar-radius-sm)',
            fontSize: 'var(--radar-font-size-sm)',
            border: '1px solid var(--radar-color-border-default)',
          }}
        >
          {erroLista}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(280px, 1fr) minmax(300px, 1fr)',
          gap: 'var(--radar-space-4)',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Lista */}
        <section
          style={{
            background: 'var(--radar-color-bg-surface)',
            border: '1px solid var(--radar-color-border-default)',
            borderRadius: 'var(--radar-radius-md)',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--radar-color-border-default)',
              fontSize: 'var(--radar-font-size-sm)',
              fontWeight: 600,
            }}
          >
            {loading ? 'Carregando…' : `${editais.length} editais`}
          </header>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {editais.map((e) => {
              const active = e.numeroControlePncp === selecionado;
              return (
                <button
                  key={e.numeroControlePncp}
                  type="button"
                  onClick={() => setSelecionado(e.numeroControlePncp)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    border: 'none',
                    borderBottom: '1px solid var(--radar-color-border-default)',
                    background: active ? 'var(--radar-color-bg-canvas)' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <Badge type="info" size="sm">
                      {e.modalidadeNome}
                    </Badge>
                    <span style={{ fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
                      {e.uf}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--radar-font-size-sm)',
                      fontWeight: 500,
                      color: 'var(--radar-color-text-default)',
                      lineHeight: 1.35,
                    }}
                  >
                    {e.objeto.length > 140 ? `${e.objeto.slice(0, 140)}…` : e.objeto}
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
                    {formatValor(e.valorEstimado)} · {e.orgao}
                  </div>
                </button>
              );
            })}
            {!loading && editais.length === 0 && (
              <p style={{ padding: 16, color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
                Nenhum edital. Clique em “Atualizar PNCP”.
              </p>
            )}
          </div>
        </section>

        {/* Detalhe */}
        <section
          style={{
            background: 'var(--radar-color-bg-surface)',
            border: '1px solid var(--radar-color-border-default)',
            borderRadius: 'var(--radar-radius-md)',
            overflow: 'auto',
            padding: 20,
          }}
        >
          {loadingDetalhe && (
            <p style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
              Carregando detalhe…
            </p>
          )}
          {!loadingDetalhe && !detalhe && (
            <p style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)' }}>
              Selecione um edital na lista.
            </p>
          )}
          {detalhe && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Badge type="info" size="sm">
                {detalhe.modalidadeNome}
              </Badge>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.4 }}>
                {detalhe.objeto}
              </h2>
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: '8px 12px',
                  fontSize: 'var(--radar-font-size-sm)',
                }}
              >
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>PNCP</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--radar-font-mono, monospace)' }}>
                  {detalhe.numeroControlePncp}
                </dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Órgão</dt>
                <dd style={{ margin: 0 }}>
                  {detalhe.orgao} ({detalhe.municipio}/{detalhe.uf})
                </dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>CNPJ</dt>
                <dd style={{ margin: 0 }}>{detalhe.orgaoCnpj}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Valor</dt>
                <dd style={{ margin: 0 }}>{formatValor(detalhe.valorEstimado)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Prazo</dt>
                <dd style={{ margin: 0 }}>{formatData(detalhe.prazoProposta)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Publicação</dt>
                <dd style={{ margin: 0 }}>{formatData(detalhe.dataPublicacao)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Fase</dt>
                <dd style={{ margin: 0 }}>{detalhe.faseAtual}</dd>
              </dl>
              {detalhe.itens.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 'var(--radar-font-size-sm)', margin: '8px 0' }}>Itens</h3>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--radar-font-size-sm)' }}>
                    {detalhe.itens.map((i) => (
                      <li key={i.numeroItem}>
                        {i.descricao} (qtd {i.quantidade}
                        {i.valorUnitarioEstimado != null
                          ? ` · ${formatValor(i.valorUnitarioEstimado)}`
                          : ''}
                        )
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Chat */}
        <section
          style={{
            background: 'var(--radar-color-bg-surface)',
            border: '1px solid var(--radar-color-border-default)',
            borderRadius: 'var(--radar-radius-md)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <header
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--radar-color-border-default)',
              fontSize: 'var(--radar-font-size-sm)',
              fontWeight: 600,
            }}
          >
            Assistente
            {selecionado ? (
              <span style={{ fontWeight: 400, color: 'var(--radar-color-text-muted)' }}>
                {' '}
                · foco {selecionado}
              </span>
            ) : null}
          </header>
          <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chat.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radar-radius-md)',
                  background:
                    m.role === 'user'
                      ? 'var(--radar-color-action-primary)'
                      : 'var(--radar-color-bg-canvas)',
                  color:
                    m.role === 'user'
                      ? 'var(--radar-color-action-primary-fg, #fff)'
                      : 'var(--radar-color-text-default)',
                  fontSize: 'var(--radar-font-size-sm)',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enviarChat();
            }}
            style={{
              display: 'flex',
              gap: 8,
              padding: 12,
              borderTop: '1px solid var(--radar-color-border-default)',
            }}
          >
            <Input
              placeholder={chatBusy ? 'Pensando…' : 'Pergunte sobre os editais…'}
              value={draft}
              disabled={chatBusy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" disabled={chatBusy || !draft.trim()}>
              Enviar
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
