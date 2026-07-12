import { randomUUID } from 'node:crypto';
import { DomainError, EditalId } from '@radar/kernel';
import { LoteExtracaoIndisponivelError } from '../../domain/errors/index.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import type { LlmLoteGateway, ResultadoLote } from '../../application/ports.js';
import {
  FERRAMENTA_EXTRACAO,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from './anthropic-llm-gateway.js';
import type { LlmExtracaoRequest } from './anthropic-llm-gateway.js';
import { extrairToolInput, paramsExtracao, usoDeMensagem } from './anthropic-extracao-schema.js';
import type { MensagemComConteudo } from './anthropic-extracao-schema.js';

/**
 * Estados de `GetModelInvocationJob` (AWS Bedrock). `Completed`/`PartiallyCompleted` são terminais de
 * SUCESSO (parcial ainda tem JSONL de saída a ler); `Failed`/`Stopped`/`Expired` são terminais de falha.
 */
export type BedrockJobStatus =
  | 'Submitted'
  | 'Validating'
  | 'Scheduled'
  | 'InProgress'
  | 'Completed'
  | 'PartiallyCompleted'
  | 'Failed'
  | 'Stopping'
  | 'Stopped'
  | 'Expired';

/**
 * Client mínimo do plano de controle do batch inference (`CreateModelInvocationJob`/
 * `GetModelInvocationJob`), provider-agnóstico — o SDK concreto (`@aws-sdk/client-bedrock`) é ligado
 * no composition root (P-74); `bedrock.createModelInvocationJob`/`getModelInvocationJob` casam
 * estruturalmente com esta interface. Um job = UM modelo (a API não aceita lote multi-modelo).
 */
export interface BedrockBatchJobClient {
  create(input: {
    readonly modelId: string;
    readonly inputRef: string;
    readonly outputRef: string;
    readonly roleArn: string;
  }): Promise<{ readonly jobArn: string }>;
  retrieve(jobArn: string): Promise<{ readonly status: BedrockJobStatus }>;
}

/**
 * Client mínimo de leitura/escrita do JSONL em S3 (in/out do job, RAD-236). `ref` é o URI/key completo
 * — o adapter monta um ref por lote (`gerarIdLote`), nunca reusa entre jobs.
 */
export interface BedrockBatchStorageClient {
  put(ref: string, conteudo: string, opts: { readonly signal: AbortSignal }): Promise<void>;
  get(ref: string, opts: { readonly signal: AbortSignal }): Promise<string>;
}

/**
 * Fallback SÍNCRONO (`InvokeModel`) usado quando o acumulador fecha a janela com MENOS itens que o
 * mínimo do job de batch (Service Quotas). Devolve a mensagem completa (content + usage) — sem
 * streaming/refusal-handling do `AnthropicSdkClient`: o fallback é raro e os editais não são
 * diferentes dos que iriam ao job, mas a implementação concreta decide se precisa de streaming.
 */
export interface BedrockInvokeClient {
  invoke(req: LlmExtracaoRequest, opts: { readonly signal: AbortSignal }): Promise<MensagemComConteudo>;
}

/** Uma linha do JSONL de saída (`<input>.jsonl.out`). `modelOutput` ausente = item falhou (`error`). */
export interface BedrockBatchOutputLine {
  readonly recordId: string;
  readonly modelOutput?: MensagemComConteudo;
  readonly error?: { readonly errorCode?: string; readonly errorMessage?: string };
}

/** Refs de infra entregues pelo RAD-236 (`batch_input_ref`/`batch_output_ref`/`batch_service_role_ref`). */
export interface BedrockBatchRefs {
  readonly inputRef: string;
  readonly outputRef: string;
  readonly roleArn: string;
}

/**
 * Matriz de BATCH inference do Bedrock (P-93): cobre Haiku 4.5 / Sonnet 4.6 / Opus 4.5-4.6 — NÃO cobre
 * Sonnet 5 nem Opus 4.8, os tiers do router SÍNCRONO (`escolherModelo` em `anthropic-llm-gateway.ts`).
 * Mapeia cada tier síncrono ao par batch-capable mais próximo. `[A VALIDAR]` (Iara, RAD-237): a matriz
 * muda com o tempo — revalidar contra o catálogo Bedrock real (Service Quotas + model catalog do
 * console) antes do primeiro deploy; não confirmável neste ambiente sem credenciais AWS.
 */
export const MODELO_BATCH_BEDROCK_PADRAO: Readonly<Record<string, string>> = {
  'claude-sonnet-5': 'anthropic.claude-sonnet-4-6-v1:0',
  'claude-opus-4-8': 'anthropic.claude-opus-4-6-v1:0',
};

/**
 * ID Bedrock completo (`MODELO_BATCH_BEDROCK_PADRAO`) → nome NU do tier — a MESMA chave usada em
 * `PRECOS_USD_POR_MILHAO_TOKENS` (RAD-341). O ID Bedrock serve só para a chamada de API
 * (`modelId`/fallback on-demand); o `UsoLlm.modelo` gravado no ledger precisa do nome nu, nunca do ID
 * Bedrock — senão `calcularCustoUsd` nunca casa a tabela e cai sempre no fallback de Opus (achado
 * RAD-341, adjacente ao RAD-337/RAD-340). Mantida como tabela explícita (não derivada por parsing do
 * ID) porque o formato do ID é decisão do catálogo Bedrock, fora do nosso controle.
 */
const NOME_NU_POR_MODELO_BATCH_BEDROCK: Readonly<Record<string, string>> = {
  'anthropic.claude-sonnet-4-6-v1:0': 'claude-sonnet-4-6',
  'anthropic.claude-opus-4-6-v1:0': 'claude-opus-4-6',
};

/** Resolver padrão — lança em vez de "chutar" um modelo desconhecido (nunca submeter ao job errado). */
export function resolverModeloBatchPadrao(modeloSincrono: string): string {
  const modelo = MODELO_BATCH_BEDROCK_PADRAO[modeloSincrono];
  if (modelo === undefined) {
    throw new LoteExtracaoIndisponivelError(
      `modelo "${modeloSincrono}" sem par batch-capable conhecido no Bedrock (P-93)`,
    );
  }
  return modelo;
}

/**
 * Nome nu (chave de `PRECOS_USD_POR_MILHAO_TOKENS`) do ID Bedrock resolvido — para `UsoLlm.modelo`.
 * Lança em vez de "chutar" o ID Bedrock cheio: um `NOME_NU_POR_MODELO_BATCH_BEDROCK` desatualizado
 * (nova entrada em `MODELO_BATCH_BEDROCK_PADRAO` sem par aqui) reproduziria em silêncio a MESMA classe
 * de bug da RAD-341 — falhar o item é mais seguro que gravar um custo que nunca bate o catálogo.
 */
function nomeNuDoModeloBedrock(modeloBedrock: string): string {
  const nomeNu = NOME_NU_POR_MODELO_BATCH_BEDROCK[modeloBedrock];
  if (nomeNu === undefined) {
    throw new LoteExtracaoIndisponivelError(
      `modelo Bedrock "${modeloBedrock}" sem nome nu conhecido para precificação (RAD-341)`,
    );
  }
  return nomeNu;
}

export interface BedrockBatchLlmGatewayOpts {
  /**
   * Mínimo de registros por job de batch inference (Service Quotas: "Minimum number of records per
   * batch inference job"). SEM DEFAULT de propósito — `[A VALIDAR]` (RAD-237): confirmar o número real
   * no console antes do primeiro deploy; um default inventado aqui mascararia silenciosamente o valor
   * errado. Abaixo do mínimo, o lote cai no fallback on-demand (`BedrockInvokeClient`).
   */
  readonly minimoRegistrosPorJob: number;
  /** Mapeia o modelo do router síncrono para o par batch-capable do Bedrock; default = P-93 atual. */
  readonly resolverModeloBatch?: (modeloSincrono: string) => string;
  /** Intervalo entre verificações de status do job (default 60s — SLA ~24h, não 15s como a Anthropic). */
  readonly intervaloPollMs?: number;
  /** Teto de verificações antes de desistir (default 1440 ≈ 24h a 60s). */
  readonly maxPolls?: number;
  /** Injetável para teste; default `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Gera o id único do lote (prefixo dos refs de input/output do job); default `randomUUID()`. */
  readonly gerarIdLote?: () => string;
}

interface EntradaPreparada {
  readonly entrada: EntradaExtracaoDTO;
  readonly req: LlmExtracaoRequest; // modelo JÁ resolvido para o par batch-capable do Bedrock
}

/**
 * `BedrockBatchLlmGateway` — transporte em LOTE da extração no `CreateModelInvocationJob` nativo do
 * Bedrock (P-92/P-66, RAD-231/RAD-237): a Message Batches API da Anthropic não é servida pelo Bedrock,
 * mas o batch inference nativo entrega o MESMO −50% (JSONL em S3, ~24h). Reusa a MESMA construção de
 * requisição (`montarRequisicaoExtracao`) e interpretação de saída (`extrairToolInput` +
 * `interpretarSaidaExtracao`) do caminho síncrono → inferência idêntica (A11 §2 vale por construção);
 * só troca o `modelo` pelo par batch-capable (P-93) e o transporte.
 *
 * Um job = UM modelo (a API não mistura modelos num job): agrupa as entradas por modelo resolvido e
 * dispara um job POR GRUPO, em paralelo (`Promise.all` — cada job pode levar até 24h, não serializar).
 * Grupo abaixo do mínimo de registros cai no fallback `BedrockInvokeClient` (on-demand, sem desconto).
 *
 * `recordId` deriva de `editalId` (sanitizado para o charset alfanumérico do Bedrock) — NUNCA por
 * posição: os resultados são casados de volta via `Map<recordId, entrada>`, indiferente à ordem do
 * JSONL de saída, e o lote pode ser parcialmente falho (item cai, o lote segue).
 */
export class BedrockBatchLlmGateway implements LlmLoteGateway {
  private readonly minimoRegistrosPorJob: number;
  private readonly resolverModelo: (modeloSincrono: string) => string;
  private readonly intervaloPollMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly gerarIdLote: () => string;

  constructor(
    private readonly jobs: BedrockBatchJobClient,
    private readonly storage: BedrockBatchStorageClient,
    private readonly onDemand: BedrockInvokeClient,
    private readonly refs: BedrockBatchRefs,
    opts: BedrockBatchLlmGatewayOpts,
  ) {
    this.minimoRegistrosPorJob = opts.minimoRegistrosPorJob;
    this.resolverModelo = opts.resolverModeloBatch ?? resolverModeloBatchPadrao;
    this.intervaloPollMs = opts.intervaloPollMs ?? 60_000;
    this.maxPolls = opts.maxPolls ?? 1_440;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.gerarIdLote = opts.gerarIdLote ?? (() => randomUUID());
  }

  async extrairLote(entradas: readonly EntradaExtracaoDTO[], signal: AbortSignal): Promise<ResultadoLote[]> {
    if (entradas.length === 0) return [];

    const preparadas = entradas.map((entrada): EntradaPreparada => {
      const req = montarRequisicaoExtracao(entrada);
      return { entrada, req: { ...req, modelo: this.resolverModelo(req.modelo) } };
    });

    const grupos = new Map<string, EntradaPreparada[]>();
    for (const p of preparadas) {
      const grupo = grupos.get(p.req.modelo);
      if (grupo) grupo.push(p);
      else grupos.set(p.req.modelo, [p]);
    }

    const porGrupo = await Promise.all(
      [...grupos.entries()].map(([modelo, grupo]) =>
        grupo.length < this.minimoRegistrosPorJob
          ? this.extrairOnDemand(grupo, signal)
          : this.extrairViaJob(modelo, grupo, signal),
      ),
    );
    return porGrupo.flat();
  }

  /** Um grupo (mesmo modelo) inteiro via `CreateModelInvocationJob`. */
  private async extrairViaJob(
    modelo: string,
    grupo: readonly EntradaPreparada[],
    signal: AbortSignal,
  ): Promise<ResultadoLote[]> {
    const loteId = this.gerarIdLote();
    const inputRef = `${this.refs.inputRef}/${loteId}.jsonl`;
    const outputRef = `${this.refs.outputRef}/${loteId}/`;

    const porRecordId = new Map<string, EntradaExtracaoDTO>();
    const linhas: string[] = [];
    for (const { entrada, req } of grupo) {
      const recordId = recordIdDoEdital(String(entrada.editalId));
      if (porRecordId.has(recordId)) {
        throw new LoteExtracaoIndisponivelError(`recordId colidiu para editalId=${entrada.editalId}`);
      }
      porRecordId.set(recordId, entrada);
      linhas.push(JSON.stringify({ recordId, modelInput: modelInputDoRequest(req) }));
    }

    await this.storage.put(inputRef, linhas.join('\n'), { signal });
    const { jobArn } = await this.jobs.create({
      modelId: modelo,
      inputRef,
      outputRef,
      roleArn: this.refs.roleArn,
    });
    await this.aguardarConclusao(jobArn, signal);

    const bruto = await this.storage.get(outputRef, { signal });
    const vistos = new Set<string>();
    const resultados: ResultadoLote[] = [];
    for (const linhaTexto of bruto.split('\n')) {
      if (linhaTexto.trim().length === 0) continue;
      const linha = JSON.parse(linhaTexto) as BedrockBatchOutputLine;
      const entrada = porRecordId.get(linha.recordId);
      if (entrada === undefined) continue; // resultado sem edital correspondente — ignora
      vistos.add(linha.recordId);
      resultados.push(this.interpretarLinha(entrada, linha, modelo));
    }

    // Edital pedido mas sem resultado no lote — explícito, para nunca "sumir" silenciosamente.
    for (const [recordId, entrada] of porRecordId) {
      if (!vistos.has(recordId)) {
        resultados.push({
          editalId: EditalId(entrada.editalId),
          ok: false,
          motivo: 'resultado ausente no lote',
        });
      }
    }
    return resultados;
  }

  /** Fallback quando o grupo fecha ABAIXO do mínimo de registros do job — invoke on-demand, sem desconto. */
  private async extrairOnDemand(
    grupo: readonly EntradaPreparada[],
    signal: AbortSignal,
  ): Promise<ResultadoLote[]> {
    const resultados: ResultadoLote[] = [];
    for (const { entrada, req } of grupo) {
      const editalId = EditalId(entrada.editalId);
      try {
        const mensagem = await this.onDemand.invoke(req, { signal });
        const bruto = extrairToolInput(mensagem, FERRAMENTA_EXTRACAO);
        const extracao = interpretarSaidaExtracao(bruto, entrada);
        // Fallback ABAIXO do mínimo de registros do job: preço CHEIO, sem o −50% do lote (RAD-340).
        // `UsoLlm.modelo` grava o nome NU (chave de preço), nunca o ID Bedrock da chamada (RAD-341).
        const uso = usoDeMensagem(mensagem, nomeNuDoModeloBedrock(req.modelo), 'on_demand');
        resultados.push({ editalId, ok: true, extracao, uso });
      } catch (err) {
        // Saída fora do schema (camada 3) é falha ESPERADA (DomainError): o item cai, o lote segue.
        if (err instanceof DomainError) {
          resultados.push({ editalId, ok: false, motivo: err.message });
          continue;
        }
        throw err;
      }
    }
    return resultados;
  }

  /** Um item do JSONL de saída → agregado (sucesso) ou falha do edital (o lote NÃO cai por um item). */
  private interpretarLinha(
    entrada: EntradaExtracaoDTO,
    linha: BedrockBatchOutputLine,
    modelo: string,
  ): ResultadoLote {
    const editalId = EditalId(entrada.editalId);
    if (linha.modelOutput === undefined) {
      const motivo = linha.error?.errorMessage ?? linha.error?.errorCode ?? 'erro desconhecido';
      return { editalId, ok: false, motivo: `lote: ${motivo}` };
    }
    try {
      const bruto = extrairToolInput(linha.modelOutput, FERRAMENTA_EXTRACAO);
      const extracao = interpretarSaidaExtracao(bruto, entrada);
      // Saiu do `CreateModelInvocationJob` — transporte em lote, −50% de custo (RAD-340).
      // `UsoLlm.modelo` grava o nome NU (chave de preço), nunca o ID Bedrock da chamada (RAD-341).
      const uso = usoDeMensagem(linha.modelOutput, nomeNuDoModeloBedrock(modelo), 'lote');
      return { editalId, ok: true, extracao, uso };
    } catch (err) {
      if (err instanceof DomainError) return { editalId, ok: false, motivo: err.message };
      throw err;
    }
  }

  /** Poll até status terminal, honrando o AbortSignal a cada volta (P-78). SLA ~24h — não é latency-sensitive. */
  private async aguardarConclusao(jobArn: string, signal: AbortSignal): Promise<void> {
    for (let i = 0; i < this.maxPolls; i++) {
      if (signal.aborted) throw new LoteExtracaoIndisponivelError('operação abortada');
      const { status } = await this.jobs.retrieve(jobArn);
      if (status === 'Completed' || status === 'PartiallyCompleted') return;
      if (status === 'Failed' || status === 'Stopped' || status === 'Expired') {
        throw new LoteExtracaoIndisponivelError(`job ${jobArn} terminou com status ${status}`);
      }
      await this.sleep(this.intervaloPollMs);
    }
    throw new LoteExtracaoIndisponivelError(`job ${jobArn} não concluiu após ${this.maxPolls} verificações`);
  }
}

/** Body do `InvokeModel`/batch para modelos Anthropic no Bedrock — sem `model` (é parâmetro do job). */
function modelInputDoRequest(req: LlmExtracaoRequest): Record<string, unknown> {
  const params = paramsExtracao(req);
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: params.max_tokens,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.tool_choice,
  };
}

/**
 * `recordId` do Bedrock aceita só `[0-9a-zA-Z]` — `EditalId` é um UUID interno (com hífens), então
 * sanitiza removendo tudo que não é alfanumérico. Colisão é verificada no chamador (`extrairViaJob`).
 */
function recordIdDoEdital(editalId: string): string {
  return editalId.replace(/[^0-9a-zA-Z]/g, '');
}
