import { SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { UsoLlm } from '../../application/ports.js';
import type { LlmExtracaoRequest } from './anthropic-llm-gateway.js';
import { CATEGORIAS, FERRAMENTA_EXTRACAO, SEVERIDADES } from './anthropic-llm-gateway.js';

/**
 * Peças ESPECÍFICAS da API Anthropic compartilhadas pelos DOIS transportes — o `LlmClient` síncrono
 * (composition root) e o `AnthropicBatchLlmGateway` (Message Batches, RAD-54). Centralizá-las aqui é o
 * que garante inferência IDÊNTICA: mesmo `tool` (schema), mesmo mapeamento de `LlmExtracaoRequest` para
 * os `params` da mensagem, mesma extração do input da ferramenta. Só muda o transporte (síncrono ↔ lote).
 *
 * Dados PUROS (sem `@anthropic-ai/sdk` importado — P-74): o SDK concreto entra só no composition root,
 * que passa os `params` construídos aqui para `messages.create` (síncrono) ou `messages.batches.create`
 * (lote). Os `ExtracaoMessageParams` casam estruturalmente com `MessageCreateParams` do SDK.
 */

/** Teto de saída da extração. Estruturada e curta; sem streaming (o lote é assíncrono, P-45). */
export const MAX_TOKENS_EXTRACAO = 8192;

interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /**
   * `strict: true` (lever 5a, RAD-55) — o `tool_use.input` é garantido schema-válido, cortando
   * `SaidaLlmInvalidaError`/retry por lixo estrutural. Aplica-se aos DOIS transportes (síncrono e lote),
   * mantendo a inferência idêntica. Não relaxa nada: a camada 3 (`validarSaidaExtracao`) segue autoridade.
   */
  readonly strict: boolean;
  readonly input_schema: Record<string, unknown>;
}

/**
 * `anyOf: [schema, null]` — forma canônica de campo NULÁVEL no structured output com `strict: true`
 * (type-array `['x','null']` não é suportado no modo estrito; `anyOf` é). Descrições vão no wrapper.
 */
function nulavel(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: 'null' }] };
}

/** Schema de citação (objeto | null) — casa com `citacaoBruta` da validação (camada 3). */
const CITACAO_SCHEMA: Record<string, unknown> = nulavel({
  type: 'object',
  properties: {
    pagina: { type: 'integer', description: 'Página (1-indexada) onde o trecho aparece.' },
    secao: nulavel({ type: 'string', description: 'Seção/cláusula, se houver.' }),
    trecho: { type: 'string', description: 'Trecho-fonte LITERAL copiado do edital.' },
  },
  required: ['pagina', 'secao', 'trecho'],
  additionalProperties: false,
});

/**
 * Campo crítico com confiança e citação — casa com `campoBruto` da validação. `valor` já vem como
 * schema (nulável ou não). Faixa da confiança (∈ [0,1]) NÃO entra: `minimum`/`maximum` não são
 * suportados sob `strict` — quem valida a faixa é a camada 3 (`confiancaNum`).
 */
function campoSchema(valor: Record<string, unknown>, descricao: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      valor: { ...valor, description: descricao },
      confianca: { type: 'number', description: 'Confiança em [0,1] (faixa validada na camada 3).' },
      citacao: CITACAO_SCHEMA,
    },
    required: ['valor', 'confianca', 'citacao'],
    additionalProperties: false,
  };
}

/**
 * `registrar_extracao` — saída estruturada estrita (camada 3 / lever 5a). O NOME é `FERRAMENTA_EXTRACAO`
 * e os enums vêm de `CATEGORIAS`/`SEVERIDADES` (fonte única com a validação), para o schema nunca
 * divergir do validador. `strict: true` + `additionalProperties:false` + `required` em TODO objeto.
 */
export const FERRAMENTA_SCHEMA: ToolSchema = {
  name: FERRAMENTA_EXTRACAO,
  strict: true,
  description:
    'Registra os FATOS extraídos do edital. Cada campo/requisito/risco cita a página e o trecho-fonte; ' +
    'sem base textual, a citação fica nula — nunca inventar.',
  input_schema: {
    type: 'object',
    properties: {
      objeto: campoSchema({ type: 'string' }, 'Objeto da licitação (o que está sendo contratado).'),
      valorEstimado: campoSchema(
        nulavel({ type: 'number' }),
        'Valor estimado em reais; null se sigiloso/omitido.',
      ),
      dataAberturaPropostas: campoSchema(
        nulavel({ type: 'string' }),
        'Data de abertura das propostas em ISO-8601; null se ausente.',
      ),
      requisitos: {
        type: 'array',
        description: 'Exigências de habilitação extraídas do edital.',
        items: {
          type: 'object',
          properties: {
            categoria: { type: 'string', enum: [...CATEGORIAS] },
            descricao: { type: 'string' },
            citacao: CITACAO_SCHEMA,
          },
          required: ['categoria', 'descricao', 'citacao'],
          additionalProperties: false,
        },
      },
      riscos: {
        type: 'array',
        description: 'Riscos/lacunas identificados no edital.',
        items: {
          type: 'object',
          properties: {
            descricao: { type: 'string' },
            severidade: { type: 'string', enum: [...SEVERIDADES] },
            citacao: CITACAO_SCHEMA,
          },
          required: ['descricao', 'severidade', 'citacao'],
          additionalProperties: false,
        },
      },
    },
    required: ['objeto', 'valorEstimado', 'dataAberturaPropostas', 'requisitos', 'riscos'],
    additionalProperties: false,
  },
};

/**
 * `MessageCreateParams` mínimo (estruturalmente compatível com o SDK). O composition root passa isto a
 * `messages.create` (síncrono) e o lote a `messages.batches.create({requests:[{custom_id, params}]})`.
 */
export interface ExtracaoMessageParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: ReadonlyArray<{ readonly role: 'user'; readonly content: string }>;
  readonly tools: readonly ToolSchema[];
  readonly tool_choice: { readonly type: 'tool'; readonly name: string };
}

/**
 * Mapeia a requisição tech-agnóstica (`montarRequisicaoExtracao`) para os `params` da mensagem: força
 * tool use (structured output), sem texto livre (camada 3). O MESMO mapeamento no síncrono e no lote.
 */
export function paramsExtracao(req: LlmExtracaoRequest): ExtracaoMessageParams {
  return {
    model: req.modelo,
    max_tokens: MAX_TOKENS_EXTRACAO,
    system: req.system,
    messages: [{ role: 'user', content: req.userContent }],
    tools: [FERRAMENTA_SCHEMA],
    tool_choice: { type: 'tool', name: req.ferramenta },
  };
}

/** Bloco de conteúdo de uma resposta (estruturalmente compatível com `ContentBlock` do SDK). */
interface BlocoConteudo {
  readonly type: string;
  readonly name?: string;
  readonly input?: unknown;
}

/**
 * `usage` cru do SDK (`Message.usage`) — estruturalmente compatível, mesma convenção das demais
 * interfaces deste arquivo (P-74: sem importar `@anthropic-ai/sdk`). Campos de cache ausentes
 * quando o provedor/chamada não usou prompt caching (P-95, ainda não ligado por `paramsExtracao`).
 */
export interface UsageBruto {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

/** Resposta com conteúdo — casa com `Message` do SDK e com cada resultado `succeeded` do lote. */
export interface MensagemComConteudo {
  readonly content: readonly BlocoConteudo[];
  readonly usage: UsageBruto;
}

/**
 * Mapeia o `usage` cru (snake_case, formato SDK) para `UsoLlm` (application, RAD-230) — mesma
 * função para o caminho síncrono (`AnthropicSdkClient`) e o lote (`AnthropicBatchLlmGateway`), para
 * as duas medições nunca divergirem. `modelo` não vem no `usage` da resposta — o caller passa o
 * mesmo `modelo` que montou a requisição (`LlmExtracaoRequest.modelo`).
 */
export function usoDeMensagem(mensagem: MensagemComConteudo, modelo: string): UsoLlm {
  return {
    modelo,
    inputTokens: mensagem.usage.input_tokens,
    outputTokens: mensagem.usage.output_tokens,
    cacheReadInputTokens: mensagem.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: mensagem.usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Extrai o INPUT da ferramenta forçada da resposta. A ausência do bloco `tool_use` esperado é saída
 * fora do contrato — rejeitada como não-confiável (camada 3), nunca "consertada". O input devolvido
 * é `unknown` e vai para `interpretarSaidaExtracao` (validação por schema).
 */
export function extrairToolInput(mensagem: MensagemComConteudo, ferramenta: string): unknown {
  const bloco = mensagem.content.find((b) => b.type === 'tool_use' && b.name === ferramenta);
  if (bloco === undefined) {
    throw new SaidaLlmInvalidaError(`resposta sem uso da ferramenta "${ferramenta}"`);
  }
  return bloco.input;
}
