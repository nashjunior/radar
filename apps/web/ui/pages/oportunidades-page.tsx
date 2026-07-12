/** @figma — tela demo local: lista PNCP + detalhe + chat */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Input } from '@/ui/components';
import { DemoPncpHttpGateway, ehErroRedeTransitorio, mensagemErroRede } from '@/infra/api/demo-pncp-http-gateway';
import type { DemoEditalCard, DemoEditalDetalhe } from '@/infra/api/demo-pncp-http-gateway';
import { authGateway } from '@/infra/container';
import { useUseCases } from '@/ui/providers/use-cases-provider';

const apiBase = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';
const gateway = new DemoPncpHttpGateway(apiBase, () => authGateway.obterToken());

const ATALHOS_BUSCA = [
  {
    label: 'Construção / obras',
    q: 'obra construção reforma pavimentação engenharia edificação manutenção predial terraplanagem',
  },
  {
    label: 'TI / software',
    q: 'tecnologia software informática sistema hardware rede datacenter licença computadores impressora digitalização',
  },
  {
    label: 'Saúde',
    q: 'saúde médico hospital medicamento paciente ambulância ultrassom laboratório odontológico enfermagem',
  },
  {
    label: 'Transporte',
    q: 'transporte frete veículo ônibus van ambulância quilômetro locação frota motocicleta',
  },
  {
    label: 'Alimentação',
    q: 'alimentação merenda gênero alimentício refeição carne hortifruti lanche escolar cozinha',
  },
  {
    label: 'Limpeza / conservação',
    q: 'limpeza conservação higienização desinsetização jardinagem portaria vigilância patrimonial',
  },
  {
    label: 'Educação',
    q: 'educação escola aluno material didático mobília escolar livro uniforme capacitação',
  },
  {
    label: 'Medicamentos / farmácia',
    q: 'medicamento farmácia fármaco remédio insumos hospitalares',
  },
  {
    label: 'Locação / serviços contínuos',
    q: 'locação prestação de serviços continuados mão de obra terceirização',
  },
  { label: 'Limpar filtros', q: '' },
] as const;

const UFS_BR = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
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

const BOAS_VINDAS =
  'Sou especialista em contratação pública. Descreva sua empresa (ramo, porte, UF, o que já entrega) ' +
  'e pergunte se a oportunidade selecionada faz sentido — inclusive se vale entrar só por presença/aprendizado. ' +
  'Respondo só questões técnicas de licitação e fecho com recomendação Participar / com ressalvas / Não participar.';

/** Mensagens do usuário que descrevem a empresa (não perguntas pontuais sobre o edital). */
function parecePerfilEmpresa(msg: string): boolean {
  if (msg.length >= 100) return true;
  return /\b(somos|empresa|me\b|epp|ltda|eireli|cnpj|cnae|atuo|atuamos|porte|faturamento|ramo|prestamos|fornecemos|trabalhamos|sediada|sediados|estado|município|municipio|transporte|construção|construcao|tecnologia|serviços|servicos)\b/i.test(
    msg,
  );
}

function montarChatNovoFoco(opts: {
  numero: string;
  perfil: readonly string[];
  trocou: boolean;
}): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: 'assistant', text: BOAS_VINDAS }];
  if (opts.perfil.length > 0) {
    msgs.push({
      role: 'assistant',
      text:
        (opts.trocou
          ? 'Troquei de edital: a oportunidade anterior saiu do contexto. '
          : '') +
        'Perfil da empresa mantido:\n' +
        opts.perfil.map((p) => `• ${p}`).join('\n'),
    });
  }
  msgs.push({
    role: 'assistant',
    text: `Foco agora: ${opts.numero}. Pergunte se vale participar com esse perfil.`,
  });
  return msgs;
}

export function OportunidadesPage() {
  const { consultarPerfilHabilitacao } = useUseCases();
  const [editais, setEditais] = useState<DemoEditalCard[]>([]);
  const [coletadoEm, setColetadoEm] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [ufFiltro, setUfFiltro] = useState('');
  const [loading, setLoading] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DemoEditalDetalhe | null>(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);

  const [chat, setChat] = useState<ChatMsg[]>([{ role: 'assistant', text: BOAS_VINDAS }]);
  const [draft, setDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  /** Perfil da empresa digitado pelo usuário — sobrevive à troca de edital. */
  const perfilEmpresaRef = useRef<string[]>([]);
  const focoAnteriorRef = useRef<string | null>(null);

  // Pré-carrega Perfil de Habilitação salvo → contexto do chat sem digitar de novo.
  useEffect(() => {
    const ctrl = new AbortController();
    void consultarPerfilHabilitacao
      .executar({}, ctrl.signal)
      .then((perfil) => {
        if (!perfil || ctrl.signal.aborted) return;
        const blocos = [
          perfil.habJuridica,
          perfil.habFiscal,
          perfil.habTecnica,
          perfil.habEconomica,
        ]
          .map((s) => s.trim())
          .filter(Boolean);
        if (blocos.length > 0) perfilEmpresaRef.current = blocos;
      })
      .catch(() => {
        /* perfil opcional no chat */
      });
    return () => ctrl.abort();
  }, [consultarPerfilHabilitacao]);

  const carregar = useCallback(async (
    refresh = false,
    overrides?: { busca?: string; uf?: string },
  ) => {
    const termo = overrides?.busca !== undefined ? overrides.busca : busca;
    const uf = overrides?.uf !== undefined ? overrides.uf : ufFiltro;
    setLoading(true);
    try {
      const res = await comRetry(() =>
        gateway.listar({
          ...(termo.trim() ? { q: termo.trim() } : {}),
          ...(uf.trim() ? { uf: uf.trim().toUpperCase() } : {}),
          refresh,
          signal: AbortSignal.timeout(60_000),
        }),
      );
      setEditais(res.editais);
      setColetadoEm(res.coletadoEm);
      setErroLista(null);
      if (res.editais[0]) {
        setSelecionado((atual) => {
          const aindaNaLista = res.editais.some((e) => e.numeroControlePncp === atual);
          return aindaNaLista ? atual : res.editais[0]!.numeroControlePncp;
        });
      } else {
        setSelecionado(null);
      }
    } catch (err) {
      setEditais((atuais) => {
        if (atuais.length === 0) setErroLista(mensagemErroRede(err));
        return atuais;
      });
    } finally {
      setLoading(false);
    }
  }, [busca, ufFiltro]);
  useEffect(() => {
    void carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial
  }, []);

  useEffect(() => {
    if (!selecionado) {
      setDetalhe(null);
      return;
    }
    const anterior = focoAnteriorRef.current;
    const trocouDeEdital = anterior !== null && anterior !== selecionado;
    focoAnteriorRef.current = selecionado;

    const ac = new AbortController();
    setLoadingDetalhe(true);
    void gateway
      .detalhe(selecionado, ac.signal)
      .then((d) => {
        setDetalhe(d);
        // Troca de card: zera histórico da oportunidade, mantém perfil da empresa.
        // Primeira seleção: só anuncia o foco sem apagar as boas-vindas se não houver perfil.
        if (trocouDeEdital) {
          setChat(
            montarChatNovoFoco({
              numero: d.numeroControlePncp,
              perfil: perfilEmpresaRef.current,
              trocou: true,
            }),
          );
        } else if (anterior === null) {
          setChat((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `Foco agora: ${d.numeroControlePncp}. Descreva sua empresa ou pergunte se vale participar.`,
            },
          ]);
        }
      })
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
    const foco = detalhe?.numeroControlePncp ?? selecionado;
    if (!foco) {
      setChat((prev) => [
        ...prev,
        { role: 'user', text: msg },
        {
          role: 'assistant',
          text: 'Selecione um edital no primeiro quadro para eu usar o detalhe do painel do meio como contexto.',
        },
      ]);
      setDraft('');
      return;
    }

    if (parecePerfilEmpresa(msg)) {
      const jaTem = perfilEmpresaRef.current.some(
        (p) => p.toLowerCase() === msg.toLowerCase(),
      );
      if (!jaTem) perfilEmpresaRef.current = [...perfilEmpresaRef.current, msg];
    }

    setDraft('');
    setChat((prev) => [...prev, { role: 'user', text: msg }]);
    setChatBusy(true);
    try {
      const resposta = await comRetry(
        () =>
          gateway.chat(msg, {
            numeroControlePncp: foco,
            perfilEmpresa: perfilEmpresaRef.current.join('\n'),
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
            placeholder="Filtrar objeto, órgão…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void carregar(false)}
          />
          <select
            aria-label="Filtrar por UF"
            value={ufFiltro}
            onChange={(e) => {
              const uf = e.target.value;
              setUfFiltro(uf);
              void carregar(false, { uf });
            }}
            style={{
              height: 36,
              padding: '0 10px',
              borderRadius: 'var(--radar-radius-sm)',
              border: '1px solid var(--radar-color-border-default)',
              background: 'var(--radar-color-bg-surface)',
              color: 'var(--radar-color-text-default)',
              fontSize: 'var(--radar-font-size-sm)',
            }}
          >
            <option value="">Todas as UFs</option>
            {UFS_BR.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
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
              if (a.q === '') {
                setBusca('');
                setUfFiltro('');
                void carregar(false, { busca: '', uf: '' });
                return;
              }
              setBusca(a.q);
              void carregar(false, { busca: a.q });
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
                      {e.srp ? ' · SRP' : ''}
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
                {detalhe.srp ? ' · SRP' : ''}
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
                  {detalhe.urlPortalPncp ? (
                    <a
                      href={detalhe.urlPortalPncp}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ color: 'var(--radar-color-text-link, #1a5fb4)' }}
                    >
                      {detalhe.numeroControlePncp}
                    </a>
                  ) : (
                    detalhe.numeroControlePncp
                  )}
                </dd>
                {detalhe.linkSistemaOrigem && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Portal origem</dt>
                    <dd style={{ margin: 0 }}>
                      <a
                        href={detalhe.linkSistemaOrigem}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{ color: 'var(--radar-color-text-link, #1a5fb4)', wordBreak: 'break-all' }}
                      >
                        Abrir no sistema de compras
                      </a>
                    </dd>
                  </>
                )}
                {detalhe.processo && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Processo</dt>
                    <dd style={{ margin: 0 }}>
                      {detalhe.processo}
                      {detalhe.numeroCompra ? ` · compra ${detalhe.numeroCompra}` : ''}
                    </dd>
                  </>
                )}
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Órgão</dt>
                <dd style={{ margin: 0 }}>
                  {detalhe.orgao} ({detalhe.municipio}/{detalhe.uf})
                </dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>CNPJ</dt>
                <dd style={{ margin: 0 }}>{detalhe.orgaoCnpj}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Valor estimado</dt>
                <dd style={{ margin: 0 }}>{formatValor(detalhe.valorEstimado)}</dd>
                {detalhe.valorHomologado != null && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Homologado</dt>
                    <dd style={{ margin: 0 }}>{formatValor(detalhe.valorHomologado)}</dd>
                  </>
                )}
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Abertura</dt>
                <dd style={{ margin: 0 }}>{formatData(detalhe.dataAberturaProposta ?? null)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Encerramento</dt>
                <dd style={{ margin: 0 }}>{formatData(detalhe.prazoProposta)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Publicação</dt>
                <dd style={{ margin: 0 }}>{formatData(detalhe.dataPublicacao)}</dd>
                <dt style={{ color: 'var(--radar-color-text-muted)' }}>Fase</dt>
                <dd style={{ margin: 0 }}>{detalhe.faseAtual}</dd>
                {detalhe.modoDisputaNome && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Disputa</dt>
                    <dd style={{ margin: 0 }}>{detalhe.modoDisputaNome}</dd>
                  </>
                )}
                {detalhe.amparoLegalNome && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Amparo legal</dt>
                    <dd style={{ margin: 0 }}>{detalhe.amparoLegalNome}</dd>
                  </>
                )}
                {detalhe.tipoInstrumentoNome && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Instrumento</dt>
                    <dd style={{ margin: 0 }}>{detalhe.tipoInstrumentoNome}</dd>
                  </>
                )}
                {detalhe.plataformaPublicacao && (
                  <>
                    <dt style={{ color: 'var(--radar-color-text-muted)' }}>Publicado via</dt>
                    <dd style={{ margin: 0 }}>{detalhe.plataformaPublicacao}</dd>
                  </>
                )}
              </dl>
              {detalhe.informacaoComplementar && (
                <p style={{ margin: 0, fontSize: 'var(--radar-font-size-sm)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--radar-color-text-muted)' }}>Complementar: </span>
                  {detalhe.informacaoComplementar}
                </p>
              )}
              <div>
                <h3 style={{ fontSize: 'var(--radar-font-size-sm)', margin: '8px 0' }}>
                  Documentos (PNCP)
                </h3>
                {(detalhe.arquivos?.length ?? 0) === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 'var(--radar-font-size-sm)',
                      color: 'var(--radar-color-text-muted)',
                    }}
                  >
                    Nenhum anexo listado neste edital (ou PNCP indisponível no momento).
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--radar-font-size-sm)' }}>
                    {detalhe.arquivos!.map((a) => (
                      <li key={a.url} style={{ marginBottom: 4 }}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          style={{ color: 'var(--radar-color-text-link, #1a5fb4)' }}
                        >
                          {a.nome}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {detalhe.itens.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 'var(--radar-font-size-sm)', margin: '8px 0' }}>Itens</h3>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--radar-font-size-sm)' }}>
                    {detalhe.itens.map((i) => (
                      <li key={i.numeroItem} style={{ marginBottom: 8 }}>
                        <strong>#{i.numeroItem}</strong> {i.descricao}
                        <div style={{ color: 'var(--radar-color-text-muted)', marginTop: 2 }}>
                          {i.quantidade}
                          {i.unidadeMedida ? ` ${i.unidadeMedida}` : ''}
                          {i.valorUnitarioEstimado != null
                            ? ` · ${formatValor(i.valorUnitarioEstimado)}/un`
                            : ''}
                          {i.valorTotal != null ? ` · total ${formatValor(i.valorTotal)}` : ''}
                          {i.criterioJulgamentoNome ? ` · ${i.criterioJulgamentoNome}` : ''}
                          {i.materialOuServicoNome ? ` · ${i.materialOuServicoNome}` : ''}
                        </div>
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
            minWidth: 0,
            overflow: 'hidden',
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
            Especialista · contratos públicos
            {selecionado ? (
              <span style={{ fontWeight: 400, color: 'var(--radar-color-text-muted)' }}>
                {' '}
                · foco {selecionado}
              </span>
            ) : null}
          </header>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 0,
              minWidth: 0,
            }}
          >
            {chat.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  width: 'fit-content',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
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
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  minWidth: 0,
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
              placeholder={
                chatBusy
                  ? 'Avaliando…'
                  : 'Ex.: somos ME de transporte no RS — vale disputar este edital?'
              }
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
