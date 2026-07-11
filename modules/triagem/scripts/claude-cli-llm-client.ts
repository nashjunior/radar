/**
 * LlmClient usando o claude CLI autenticado — sem ANTHROPIC_API_KEY (RAD-139).
 *
 * Substitui o `AnthropicSdkClient` quando a credencial direta não está disponível
 * (heartbeat, CI sem secrets, ambiente local sem ANTHROPIC_API_KEY). A autenticação
 * vem do Claude Code instalado — `claude --print` funciona desde que o usuário tenha
 * feito login interativo ao menos uma vez (`ant auth login`).
 *
 * Roda o processo-filho em /tmp para não carregar o CLAUDE.md do projeto (evita
 * 15k+ tokens de contexto de projeto em cada chamada — reduz custo ~90%).
 *
 * Limitações vs. AnthropicSdkClient:
 *   — Não usa `tool_choice` (structured output) → parsing heurístico de JSON
 *   — Mais lento (overhead de subprocess + IPC)
 *   — Saída pode variar se o modelo adicionar prosa em volta do JSON
 *
 * Compatível como `delegate` do `RecordReplayLlmClient` — o seam de gravação
 * (RECORD mode) persiste a saída como fixture e o REPLAY roda sem CLI.
 */
import { spawnSync } from 'node:child_process';
import type {
  LlmClient,
  LlmExtracaoRequest,
  ResultadoExtracaoClient,
} from '../src/infra/adapters/anthropic-llm-gateway.js';

export interface ClaudeCliLlmClientOpts {
  /** Caminho do executável. Default: 'claude' (deve estar no PATH). */
  claudeBin?: string;
  /**
   * Modelo a usar. Default: 'claude-haiku-4-5-20251001' (mais barato; Haiku é
   * suficiente para extração simples sem contexto de projeto).
   */
  modelo?: string;
  /**
   * Diretório de trabalho do processo-filho. Default: '/tmp' (sem CLAUDE.md,
   * sem contexto de projeto — reduz custo e tokens desnecessários).
   */
  cwd?: string;
  /** Timeout em ms. Default: 120 000 ms. */
  timeoutMs?: number;
}

/**
 * Sufixo adicionado ao prompt para guiar o modelo a retornar SOMENTE JSON válido,
 * sem texto ou markdown em volta — necessário porque sem `tool_choice` o modelo
 * pode envolver o JSON em prosa.
 */
const INSTRUCAO_FORMATO = `
IMPORTANTE — formato de saída obrigatório:
Retorne SOMENTE o objeto JSON abaixo preenchido. Sem texto antes ou depois. Sem blocos \`\`\`json.
{
  "objeto": {"valor": "TEXTO_DO_OBJETO", "confianca": 0.XX, "citacao": {"pagina": 1, "secao": null, "trecho": "TRECHO_LITERAL"}},
  "valorEstimado": {"valor": 123456.78, "confianca": 0.XX, "citacao": {"pagina": 1, "secao": null, "trecho": "TRECHO_LITERAL"}},
  "dataAberturaPropostas": {"valor": "2026-03-15", "confianca": 0.XX, "citacao": {"pagina": 1, "secao": null, "trecho": "TRECHO_LITERAL"}},
  "requisitos": [{"categoria": "fiscal", "descricao": "...", "citacao": {"pagina": 1, "secao": null, "trecho": "..."}}],
  "riscos": [{"descricao": "...", "severidade": "media", "citacao": {"pagina": 1, "secao": null, "trecho": "..."}}]
}
Regras:
- confianca: número em [0,1] refletindo certeza sobre o campo (0.99 = muito certo, 0.60 = incerto)
- citacao.trecho: cópia LITERAL do edital (não parafraseie)
- citacao: null se não há base textual no edital para o campo
- valorEstimado.valor: número em reais OU null se sigiloso/ausente
- dataAberturaPropostas.valor: string ISO-8601 (YYYY-MM-DD) OU null se ausente
`.trim();

/** Envelope JSON retornado por `claude --output-format json`. */
interface CliEnvelope {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

export class ClaudeCliLlmClient implements LlmClient {
  private readonly bin: string;
  private readonly modelo: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(opts: ClaudeCliLlmClientOpts = {}) {
    this.bin = opts.claudeBin ?? 'claude';
    this.modelo = opts.modelo ?? 'claude-haiku-4-5-20251001';
    this.cwd = opts.cwd ?? '/tmp';
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  extrairViaFerramenta(req: LlmExtracaoRequest, _signal: AbortSignal): Promise<ResultadoExtracaoClient> {
    const prompt = `${req.system}\n\n${INSTRUCAO_FORMATO}\n\n${req.userContent}`;
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', this.modelo,
    ];

    const proc = spawnSync(this.bin, args, {
      input: prompt,
      encoding: 'utf8',
      timeout: this.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      cwd: this.cwd,
      env: { ...process.env, NO_COLOR: '1' },
    });

    if (proc.error) {
      throw new Error(`claude CLI erro de spawn: ${proc.error.message}`);
    }
    if (proc.status !== 0) {
      const stderr = proc.stderr ?? '';
      throw new Error(
        `claude CLI saiu com status=${proc.status ?? 'null'}. stderr: ${stderr.slice(0, 600)}`,
      );
    }

    const stdout = proc.stdout ?? '';
    if (!stdout.trim()) {
      throw new Error('claude CLI retornou stdout vazio');
    }

    // Extrai o texto-resposta do envelope {"result": "...", ...}
    let texto = stdout;
    try {
      const env = JSON.parse(stdout) as CliEnvelope;
      if (env.is_error === true) {
        throw new Error(`claude CLI sinalizou erro no envelope: ${stdout.slice(0, 400)}`);
      }
      if (typeof env.result === 'string') {
        texto = env.result;
      }
    } catch (e) {
      // SyntaxError → stdout não é envelope JSON → usa direto (text mode)
      if (!(e instanceof SyntaxError)) throw e;
      texto = stdout;
    }

    // Remove fences de markdown se o modelo as incluiu (```json ... ```)
    texto = texto
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    // Extrai o PRIMEIRO objeto JSON completo da resposta (robusto a prosa residual)
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `claude CLI não retornou JSON extraível. Resposta (primeiros 400 chars): ${texto.slice(0, 400)}`,
      );
    }

    try {
      const input = JSON.parse(match[0]) as unknown;
      // Sem `tool_choice`/API estruturada, o CLI não expõe `usage` neste modo — zero é DESCONHECIDO,
      // não "sem custo" (diferente do REPLAY do gold set); path de dev sem ANTHROPIC_API_KEY (RAD-139),
      // fora do escopo de medição de produção do RAD-230 (que mede o `AnthropicSdkClient` real).
      return Promise.resolve({
        input,
        uso: {
          modelo: this.modelo,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      });
    } catch {
      throw new Error(`claude CLI retornou JSON malformado: ${match[0].slice(0, 400)}`);
    }
  }
}
