/**
 * Chat grounded no lote PNCP já filtrado (demo local).
 * NÃO envia classe crítica / estratégia comercial (P-54) — só resumo público do catálogo.
 */

const INSTRUCAO_CHAT = [
  'Você é o assistente do Radar de Licitações (contratações públicas do PNCP).',
  'Responda APENAS com base no CONTEXTO fornecido (editais já coletados/filtrados).',
  'Cite sempre o numeroControlePNCP quando mencionar uma oportunidade.',
  'Se a informação não estiver no contexto, diga explicitamente que não sabe.',
  'Não invente valores, prazos ou recomendações go/no-go fora do que o contexto traz.',
  'Não peça nem use dados de estratégia comercial do cliente.',
].join(' ');

export interface AskOpts {
  readonly apiKey: string;
  readonly modelo: string;
  readonly pergunta: string;
  readonly contextoEditais: string;
  readonly signal?: AbortSignal;
  readonly fetchFn?: typeof fetch;
  readonly nodeEnv?: string | undefined;
}

export async function perguntarSobreLote(opts: AskOpts): Promise<string> {
  const env = opts.nodeEnv ?? process.env['NODE_ENV'];
  if (env === 'production') {
    throw new Error('ask do local-demo é proibido em NODE_ENV=production.');
  }
  if (!opts.apiKey.trim()) {
    throw new Error('GEMINI_API_KEY é obrigatório para ask.');
  }

  const fetchFn = opts.fetchFn ?? fetch;
  const modelo = opts.modelo.trim() || 'gemini-2.0-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(opts.apiKey.trim())}`;

  const userText = [
    '<contexto_editais_nao_confiavel>',
    opts.contextoEditais,
    '</contexto_editais_nao_confiavel>',
    '',
    `Pergunta do usuário: ${opts.pergunta}`,
  ].join('\n');

  const body = {
    system_instruction: { parts: [{ text: INSTRUCAO_CHAT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
  };

  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (opts.signal) init.signal = opts.signal;

  const resposta = await fetchFn(url, init);

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    throw new Error(`Gemini ask HTTP ${resposta.status}: ${detalhe.slice(0, 300)}`);
  }

  const json = (await resposta.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };

  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini bloqueou a pergunta (${json.promptFeedback.blockReason}).`);
  }

  const texto = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!texto.trim()) {
    throw new Error('Gemini não devolveu texto na resposta do ask.');
  }
  return texto.trim();
}
